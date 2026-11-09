import Foundation

/// Fælles tilstand for "tjek et link" i både app og Del-menu.
@MainActor
final class CheckModel: ObservableObject {
    enum State: Equatable {
        case idle
        case checking(LinkReport?)
        case done(LinkReport)
        case failed(String)
    }

    @Published private(set) var state: State = .idle
    private var currentTask: Task<Void, Never>?

    var checker = LinkChecker()

    func check(_ rawURL: String, linkText: String? = nil) {
        currentTask?.cancel()
        let url = rawURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !url.isEmpty else { return }

        // Vis den hurtige vurdering med det samme …
        let quick = try? checker.quickCheck(url, linkText: linkText)
        if let quick, !quick.isWeb {
            state = .done(quick)
            return
        }
        state = .checking(quick)

        // … og opdatér, når netværkstjekket er færdigt.
        let checker = self.checker
        currentTask = Task { [weak self] in
            do {
                let report = try await checker.fullCheck(url, linkText: linkText)
                guard !Task.isCancelled else { return }
                self?.state = .done(report)
            } catch {
                guard !Task.isCancelled else { return }
                if let quick {
                    self?.state = .done(quick)
                } else {
                    self?.state = .failed(error.localizedDescription)
                }
            }
        }
    }

    func fail(_ message: String) {
        currentTask?.cancel()
        state = .failed(message)
    }

    func reset() {
        currentTask?.cancel()
        state = .idle
    }
}
