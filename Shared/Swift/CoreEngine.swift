import Foundation
import JavaScriptCore

enum CoreEngineError: LocalizedError {
    case missingScript
    case scriptFailed(String)
    case callFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingScript: return "linktunnel-core.js mangler i app-pakken."
        case .scriptFailed(let message): return "Analysemotoren kunne ikke starte: \(message)"
        case .callFailed(let message): return "Analysen fejlede: \(message)"
        }
    }
}

/// Kører den fælles analysemotor (Shared/linktunnel-core.js) i JavaScriptCore,
/// så app, Del-menu og Safari-udvidelse giver præcis samme vurdering.
final class CoreEngine {
    private let context: JSContext
    private let core: JSValue
    private let lock = NSLock()

    private static var instance: CoreEngine?
    private static let instanceLock = NSLock()

    /// Delt instans – JavaScript-filen indlæses kun én gang pr. proces.
    static func shared() throws -> CoreEngine {
        instanceLock.lock()
        defer { instanceLock.unlock() }
        if let instance { return instance }
        let engine = try CoreEngine()
        instance = engine
        return engine
    }

    init(bundle: Bundle = .main) throws {
        guard let url = bundle.url(forResource: "linktunnel-core", withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8) else {
            throw CoreEngineError.missingScript
        }
        guard let context = JSContext() else {
            throw CoreEngineError.scriptFailed("JSContext kunne ikke oprettes")
        }
        context.name = "LinkTunnelCore"
        context.evaluateScript(source, withSourceURL: url)
        if let exception = context.exception {
            throw CoreEngineError.scriptFailed(exception.toString() ?? "ukendt fejl")
        }
        guard let core = context.objectForKeyedSubscript("LinkTunnelCore"), !core.isUndefined else {
            throw CoreEngineError.scriptFailed("LinkTunnelCore blev ikke defineret")
        }
        self.context = context
        self.core = core
    }

    // MARK: - Offentlige kald

    func prepare(_ url: String) throws -> PreparedLink {
        try decode(callString("prepareJSON", [url]))
    }

    func analyze(_ url: String, options: AnalyzeOptions = AnalyzeOptions()) throws -> LinkReport {
        let json = String(decoding: try JSONEncoder().encode(options), as: UTF8.self)
        return try decode(callString("analyzeJSON", [url, json]))
    }

    // MARK: - Intern

    private func callString(_ function: String, _ arguments: [String]) throws -> String {
        lock.lock()
        defer { lock.unlock() }
        context.exception = nil
        let result = core.invokeMethod(function, withArguments: arguments)
        if let exception = context.exception {
            throw CoreEngineError.callFailed(exception.toString() ?? function)
        }
        guard let result, !result.isUndefined, !result.isNull, let string = result.toString() else {
            throw CoreEngineError.callFailed("\(function) returnerede intet")
        }
        return string
    }

    private func decode<T: Decodable>(_ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }
}
