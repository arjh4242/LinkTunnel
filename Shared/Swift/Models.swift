import Foundation

/// Resultatet af en analyse – spejler objektet fra `LinkTunnelCore.analyze` i linktunnel-core.js.
struct LinkReport: Decodable, Equatable {
    enum Verdict: String, Decodable {
        case ok, caution, danger
    }

    struct Finding: Decodable, Identifiable, Equatable {
        enum Level: String, Decodable {
            case danger, warning, info, good
        }

        let id: String
        let level: Level
        let title: String
        let detail: String
    }

    let input: String
    let url: String
    let finalURL: String
    let host: String
    let displayHost: String
    let asciiHost: String
    let registrableDomain: String
    let isWeb: Bool
    let verdict: Verdict
    let score: Int
    let summary: String
    let findings: [Finding]
    let redirectChain: [String]
    let domainAgeDays: Int?
    let domainCreated: String?
    let officialBrand: String?
    let spoofed: Bool?
}

/// Svaret fra `LinkTunnelCore.prepare`.
struct PreparedLink: Decodable {
    let ok: Bool
    let reason: String?
    let url: String?
    let target: String?
    let targetASCII: String?
    let host: String?
    let isIP: Bool?
    let registrableDomain: String?
    let asciiRegistrableDomain: String?
    let shouldFollow: Bool?
}

/// Ekstra viden til analysen – sendes som JSON til JavaScript.
struct AnalyzeOptions: Encodable {
    var linkText: String?
    var redirectChain: [String]?
    var finalURL: String?
    var domainAgeDays: Int?
    var domainCreated: String?
    var networkError: String?

    init(linkText: String? = nil, facts: NetworkFacts? = nil) {
        self.linkText = linkText
        if let facts {
            redirectChain = facts.redirectChain.isEmpty ? nil : facts.redirectChain
            finalURL = facts.finalURL
            domainAgeDays = facts.domainAgeDays
            domainCreated = facts.domainCreated
            networkError = facts.networkError
        }
    }
}

/// Det, der kun kan findes ud af over netværket.
struct NetworkFacts: Codable, Equatable {
    var redirectChain: [String] = []
    var finalURL: String?
    var domainAgeDays: Int?
    var domainCreated: String?
    var networkError: String?

    /// Til Safari-udvidelsens native messaging (skal være plist-kompatibel).
    var dictionary: [String: Any] {
        var dict: [String: Any] = ["redirectChain": redirectChain]
        if let finalURL { dict["finalURL"] = finalURL }
        if let domainAgeDays { dict["domainAgeDays"] = domainAgeDays }
        if let domainCreated { dict["domainCreated"] = domainCreated }
        if let networkError { dict["networkError"] = networkError }
        return dict
    }
}

/// Hvornår der må følges omdirigeringer over netværket.
enum FollowMode: String, CaseIterable, Identifiable {
    /// Kun forkortede links (bit.ly …) og kendte nyhedsbrev-sporingslinks.
    case smart
    /// Alle links.
    case all
    /// Aldrig.
    case off

    var id: String { rawValue }

    var title: String {
        switch self {
        case .smart: return "Forkortede links og nyhedsbreve"
        case .all: return "Alle links"
        case .off: return "Aldrig"
        }
    }
}
