import Foundation

/// Samler det hele: hurtig lokal analyse + netværkstjek + endelig vurdering.
struct LinkChecker {
    var follow: FollowMode = .smart
    var checkDomainAge = true

    /// Øjeblikkelig vurdering uden netværk.
    func quickCheck(_ url: String, linkText: String? = nil) throws -> LinkReport {
        try CoreEngine.shared().analyze(url, options: AnalyzeOptions(linkText: linkText))
    }

    /// Fuld vurdering inkl. omdirigeringer og domænealder.
    func fullCheck(_ url: String, linkText: String? = nil) async throws -> LinkReport {
        let engine = try CoreEngine.shared()
        let facts = await LinkInspector.shared.inspect(url: url, follow: follow, domainAge: checkDomainAge, engine: engine)
        return try engine.analyze(url, options: AnalyzeOptions(linkText: linkText, facts: facts))
    }

    /// Finder det første link i en tekst (fx når der deles en hel besked).
    static func firstLink(in text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: trimmed), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
            return trimmed
        }
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return nil }
        let range = NSRange(trimmed.startIndex..., in: trimmed)
        let match = detector.matches(in: trimmed, options: [], range: range).first { result in
            guard let scheme = result.url?.scheme?.lowercased() else { return false }
            return scheme == "http" || scheme == "https"
        }
        return match?.url?.absoluteString
    }
}
