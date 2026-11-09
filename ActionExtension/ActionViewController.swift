import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// "Tjek med LinkTunnel" i Del-menuen.
/// Tag et link i Mail, Beskeder, Safari osv. → hold fingeren på det → Del → Tjek med LinkTunnel.
final class ActionViewController: UIViewController {
    private let model = CheckModel()

    override func viewDidLoad() {
        super.viewDidLoad()
        let root = ActionRootView(
            model: model,
            onOpen: { [weak self] url in self?.openAndClose(url) },
            onClose: { [weak self] in self?.close() }
        )
        let host = UIHostingController(rootView: root)
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)

        Task { await loadInput() }
    }

    // MARK: - Input

    private func loadInput() async {
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        var text: String?

        for item in items {
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                   let value = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil),
                   let url = (value as? URL) ?? (value as? NSURL).map({ $0 as URL }) ?? (value as? String).flatMap({ URL(string: $0) }),
                   !url.isFileURL {
                    model.check(url.absoluteString)
                    return
                }
                if text == nil,
                   provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                   let value = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) {
                    text = (value as? String) ?? (value as? NSAttributedString)?.string
                }
            }
            if text == nil, let content = item.attributedContentText?.string, !content.isEmpty {
                text = content
            }
        }

        if let text, let link = LinkChecker.firstLink(in: text) {
            model.check(link)
        } else {
            model.fail("Der blev ikke delt noget link, som kan tjekkes.")
        }
    }

    // MARK: - Handlinger

    private func close() {
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }

    private func openAndClose(_ url: URL) {
        if !openViaResponderChain(url) {
            UIPasteboard.general.url = url
        }
        close()
    }

    /// Udvidelser må ikke kalde UIApplication.shared.open direkte. Vi finder app-objektet i
    /// responder-kæden og kalder open(_:options:completionHandler:) via Objective-C-runtime.
    /// Virker i praksis i iOS 17/18, men er ikke officielt API – fejler det, kopieres linket i stedet.
    private func openViaResponderChain(_ url: URL) -> Bool {
        let selector = NSSelectorFromString("openURL:options:completionHandler:")
        var responder: UIResponder? = self
        while let current = responder {
            if current is UIApplication, current.responds(to: selector), let imp = current.method(for: selector) {
                typealias OpenFunction = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, AnyObject?) -> Void
                let open = unsafeBitCast(imp, to: OpenFunction.self)
                open(current, selector, url as NSURL, NSDictionary(), nil)
                return true
            }
            responder = current.next
        }
        return false
    }
}

private struct ActionRootView: View {
    @ObservedObject var model: CheckModel
    let onOpen: (URL) -> Void
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                content
                    .padding()
                    .frame(maxWidth: 600, alignment: .leading)
                    .frame(maxWidth: .infinity)
            }
            .navigationTitle("LinkTunnel")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Luk", action: onClose)
                }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .idle, .checking(.none):
            HStack(spacing: 10) {
                ProgressView()
                Text("Tjekker link …").foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 200)
        case .checking(let report?):
            ReportView(report: report, isLoading: true, onOpen: onOpen, onCancel: onClose)
        case .done(let report):
            ReportView(report: report, onOpen: onOpen, onCancel: onClose)
        case .failed(let message):
            VStack(spacing: 12) {
                Image(systemName: "link.badge.plus")
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
                Text(message)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 200)
        }
    }
}
