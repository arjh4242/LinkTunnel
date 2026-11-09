import SwiftUI

/// Viser en vurdering af et link. Bruges i appen og i Del-menuen.
struct ReportView: View {
    let report: LinkReport
    var isLoading = false
    var onOpen: ((URL) -> Void)?
    var onCancel: (() -> Void)?

    @State private var showFullURL = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            statusHeader

            VStack(alignment: .leading, spacing: 4) {
                Text("LINKET GÅR TIL")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(report.registrableDomain.isEmpty ? report.finalURL : report.registrableDomain)
                    .font(.title.bold())
                    .textSelection(.enabled)
                Text(report.finalURL)
                    .font(.footnote.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(showFullURL ? nil : 3)
                    .textSelection(.enabled)
                    .onTapGesture { showFullURL.toggle() }
            }

            Text(report.summary)
                .font(.headline)

            if !report.findings.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(report.findings) { finding in
                        FindingRow(finding: finding)
                        if finding.id != report.findings.last?.id {
                            Divider().padding(.leading, 32)
                        }
                    }
                }
            }

            if report.redirectChain.count > 1 {
                DisclosureGroup("Omdirigeringer (\(report.redirectChain.count - 1))") {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(report.redirectChain.enumerated()), id: \.offset) { index, url in
                            Text("\(index + 1). \(url)")
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    }
                    .padding(.top, 6)
                }
                .font(.subheadline)
            }

            if isLoading {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Tjekker omdirigeringer og domænets alder …")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            buttons
        }
    }

    private var statusHeader: some View {
        HStack(spacing: 10) {
            Image(systemName: report.verdict.symbol)
                .font(.title2)
                .foregroundStyle(report.verdict.color)
            Text(isLoading && report.verdict == .ok ? "Foreløbigt i orden" : report.verdict.title)
                .font(.headline)
                .foregroundStyle(report.verdict.color)
        }
    }

    @ViewBuilder
    private var buttons: some View {
        if onOpen != nil || onCancel != nil {
            VStack(spacing: 10) {
                if report.verdict == .danger {
                    if let onCancel {
                        Button(action: onCancel) {
                            Text("Gå tilbage").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    if let onOpen, let url = openURL {
                        Button(role: .destructive) { onOpen(url) } label: {
                            Text("Åbn alligevel").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                    }
                } else {
                    if let onOpen, let url = openURL {
                        Button { onOpen(url) } label: {
                            Text("Åbn link").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    if let onCancel {
                        Button(action: onCancel) {
                            Text("Annuller").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }
            .controlSize(.large)
        }
    }

    /// Vi åbner den oprindelige adresse (som brugeren klikkede på), så evt. login-flow virker som normalt.
    private var openURL: URL? {
        guard report.isWeb else { return URL(string: report.input) }
        return URL(string: report.url) ?? URL(string: report.finalURL)
    }
}

private struct FindingRow: View {
    let finding: LinkReport.Finding

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: finding.level.symbol)
                .foregroundStyle(finding.level.color)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(finding.title)
                    .font(.subheadline.weight(.semibold))
                if !finding.detail.isEmpty {
                    Text(finding.detail)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 8)
    }
}

extension LinkReport.Verdict {
    var title: String {
        switch self {
        case .ok: return "Ser i orden ud"
        case .caution: return "Vær opmærksom"
        case .danger: return "Advarsel – mulig svindel"
        }
    }

    var symbol: String {
        switch self {
        case .ok: return "checkmark.shield.fill"
        case .caution: return "exclamationmark.triangle.fill"
        case .danger: return "xmark.octagon.fill"
        }
    }

    var color: Color {
        switch self {
        case .ok: return .green
        case .caution: return .orange
        case .danger: return .red
        }
    }
}

extension LinkReport.Finding.Level {
    var symbol: String {
        switch self {
        case .danger: return "xmark.circle.fill"
        case .warning: return "exclamationmark.circle.fill"
        case .info: return "info.circle"
        case .good: return "checkmark.circle.fill"
        }
    }

    var color: Color {
        switch self {
        case .danger: return .red
        case .warning: return .orange
        case .info: return .secondary
        case .good: return .green
        }
    }
}
