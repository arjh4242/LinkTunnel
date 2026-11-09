import Foundation
import SafariServices
import os

/// Modtager beskeder fra Safari-udvidelsens background.js (browser.runtime.sendNativeMessage)
/// og laver netværkstjekket, som JavaScript på siden ikke selv kan lave.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private let log = Logger(subsystem: "LinkTunnel", category: "SafariExtension")

    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any]

        guard let message,
              message["type"] as? String == "inspect",
              let url = message["url"] as? String else {
            respond(context, ["networkError": "ukendt besked"])
            return
        }

        let follow = FollowMode(rawValue: message["followRedirects"] as? String ?? "") ?? .smart
        let domainAge = message["domainAge"] as? Bool ?? true

        Task {
            var facts = NetworkFacts()
            do {
                let engine = try CoreEngine.shared()
                facts = await LinkInspector.shared.inspect(url: url, follow: follow, domainAge: domainAge, engine: engine)
            } catch {
                log.error("Tjek fejlede: \(error.localizedDescription, privacy: .public)")
                facts.networkError = error.localizedDescription
            }
            respond(context, facts.dictionary)
        }
    }

    private func respond(_ context: NSExtensionContext, _ payload: [String: Any]) {
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: payload]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
