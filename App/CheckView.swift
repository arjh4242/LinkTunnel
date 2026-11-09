import SwiftUI
import UIKit

struct CheckView: View {
    @ObservedObject var model: CheckModel
    @Binding var input: String

    @AppStorage("followRedirects") private var followRaw = FollowMode.smart.rawValue
    @AppStorage("checkDomainAge") private var checkDomainAge = true
    @Environment(\.openURL) private var openURL
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    inputCard
                    result
                }
                .padding()
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("LinkTunnel")
        }
    }

    private var inputCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Indsæt et link for at se, hvor det går hen, og om det ligner svindel.")
                .foregroundStyle(.secondary)

            TextField("https://…", text: $input)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .submitLabel(.go)
                .focused($focused)
                .onSubmit(runCheck)
                .padding(12)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))

            HStack {
                Button {
                    if let text = UIPasteboard.general.url?.absoluteString ?? UIPasteboard.general.string {
                        input = LinkChecker.firstLink(in: text) ?? text
                        runCheck()
                    }
                } label: {
                    Label("Indsæt og tjek", systemImage: "doc.on.clipboard")
                }
                .buttonStyle(.bordered)

                Spacer()

                Button("Tjek", action: runCheck)
                    .buttonStyle(.borderedProminent)
                    .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    @ViewBuilder
    private var result: some View {
        switch model.state {
        case .idle:
            EmptyView()
        case .checking(.none):
            ProgressView("Tjekker link …")
                .frame(maxWidth: .infinity)
        case .checking(let report?):
            card(ReportView(report: report, isLoading: true, onOpen: open))
        case .done(let report):
            card(ReportView(report: report, onOpen: open))
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle")
                .foregroundStyle(.secondary)
        }
    }

    private func card<V: View>(_ content: V) -> some View {
        content
            .padding()
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
    }

    private func runCheck() {
        focused = false
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let link = LinkChecker.firstLink(in: text) ?? text
        model.checker = LinkChecker(follow: FollowMode(rawValue: followRaw) ?? .smart, checkDomainAge: checkDomainAge)
        model.check(link)
    }

    private func open(_ url: URL) {
        openURL(url)
    }
}
