import Foundation

/// Netværksdelen af tjekket:
///  - følger omdirigeringer med HEAD-forespørgsler (uden at åbne siden, uden cookies)
///  - slår domænets registreringsdato op via RDAP (det offentlige domæneregister)
actor LinkInspector {
    static let shared = LinkInspector()

    private let redirectSession: URLSession
    private let rdapSession: URLSession
    private var ageCache: [String: Date?] = [:]

    private static let userAgent =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 5
        config.timeoutIntervalForResource = 8
        config.httpCookieAcceptPolicy = .never
        config.httpShouldSetCookies = false
        config.urlCache = nil
        config.httpAdditionalHeaders = ["User-Agent": Self.userAgent]
        redirectSession = URLSession(configuration: config, delegate: NoRedirectDelegate(), delegateQueue: nil)

        let rdapConfig = URLSessionConfiguration.ephemeral
        rdapConfig.timeoutIntervalForRequest = 5
        rdapConfig.timeoutIntervalForResource = 8
        rdapSession = URLSession(configuration: rdapConfig)
    }

    /// Henter netværksfakta for et link.
    func inspect(url: String, follow: FollowMode, domainAge: Bool, engine: CoreEngine) async -> NetworkFacts {
        var facts = NetworkFacts()
        guard let prepared = try? engine.prepare(url), prepared.ok,
              let target = prepared.targetASCII ?? prepared.target else {
            return facts
        }

        var finalURL = target
        let shouldFollow = follow == .all || (follow == .smart && (prepared.shouldFollow ?? false))
        if shouldFollow {
            do {
                let chain = try await followRedirects(from: target)
                if chain.count > 1 {
                    facts.redirectChain = chain
                    finalURL = chain.last ?? target
                    facts.finalURL = finalURL
                }
            } catch {
                facts.networkError = Self.describe(error)
            }
        }

        if domainAge {
            let finalPrepared = finalURL == target ? prepared : ((try? engine.prepare(finalURL)) ?? prepared)
            if finalPrepared.isIP != true, let domain = finalPrepared.asciiRegistrableDomain, domain.contains(".") {
                if let created = await registrationDate(of: domain) {
                    facts.domainCreated = ISO8601DateFormatter().string(from: created)
                    facts.domainAgeDays = max(0, Calendar.current.dateComponents([.day], from: created, to: Date()).day ?? 0)
                }
            }
        }
        return facts
    }

    // MARK: - Omdirigeringer

    func followRedirects(from start: String, maxHops: Int = 10) async throws -> [String] {
        var chain = [start]
        var current = start
        for _ in 0..<maxHops {
            guard let url = URL(string: current) else { break }
            let response = try await headOrGet(url)
            guard (300...399).contains(response.statusCode),
                  let location = response.value(forHTTPHeaderField: "Location"),
                  let next = URL(string: location, relativeTo: url)?.absoluteURL else {
                break
            }
            let nextString = next.absoluteString
            let isLoop = chain.contains(nextString)
            chain.append(nextString)
            if isLoop { break }
            guard let scheme = next.scheme?.lowercased(), scheme == "http" || scheme == "https" else { break }
            current = nextString
        }
        return chain
    }

    /// HEAD først. Nogle servere afviser HEAD – så prøver vi GET og afbryder, så snart headers er modtaget.
    private func headOrGet(_ url: URL) async throws -> HTTPURLResponse {
        var head = URLRequest(url: url)
        head.httpMethod = "HEAD"
        let (_, headResponse) = try await redirectSession.data(for: head)
        if let http = headResponse as? HTTPURLResponse, ![400, 403, 404, 405, 501].contains(http.statusCode) {
            return http
        }

        var get = URLRequest(url: url)
        get.setValue("bytes=0-0", forHTTPHeaderField: "Range")
        let (bytes, getResponse) = try await redirectSession.bytes(for: get)
        bytes.task.cancel()
        guard let http = getResponse as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return http
    }

    // MARK: - Domænealder (RDAP)

    private struct RDAPResponse: Decodable {
        struct Event: Decodable {
            let eventAction: String
            let eventDate: String?
        }
        let events: [Event]?
    }

    func registrationDate(of domain: String) async -> Date? {
        if let cached = ageCache[domain] { return cached }
        var date: Date?
        if let encoded = domain.addingPercentEncoding(withAllowedCharacters: .urlHostAllowed),
           let url = URL(string: "https://rdap.org/domain/\(encoded)") {
            var request = URLRequest(url: url)
            request.setValue("application/rdap+json, application/json", forHTTPHeaderField: "Accept")
            if let result = try? await rdapSession.data(for: request),
               (result.1 as? HTTPURLResponse)?.statusCode == 200,
               let rdap = try? JSONDecoder().decode(RDAPResponse.self, from: result.0),
               let raw = rdap.events?.first(where: { $0.eventAction.lowercased() == "registration" })?.eventDate {
                date = Self.parseDate(raw)
            }
        }
        ageCache[domain] = date
        return date
    }

    static func parseDate(_ string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: string) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: string) { return date }
        formatter.formatOptions = [.withFullDate]
        return formatter.date(from: String(string.prefix(10)))
    }

    private static func describe(_ error: Error) -> String {
        if let urlError = error as? URLError {
            switch urlError.code {
            case .timedOut: return "serveren svarede ikke"
            case .notConnectedToInternet: return "ingen internetforbindelse"
            case .cannotFindHost, .dnsLookupFailed: return "domænet findes ikke"
            case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate:
                return "sikkerhedscertifikatet er ugyldigt"
            default: break
            }
        }
        return error.localizedDescription
    }
}

/// Stopper automatiske omdirigeringer, så vi selv kan registrere hvert hop.
private final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession,
                    task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
