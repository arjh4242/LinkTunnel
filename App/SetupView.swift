import SwiftUI
import UIKit

struct SetupView: View {
    @AppStorage("followRedirects") private var followRaw = FollowMode.smart.rawValue
    @AppStorage("checkDomainAge") private var checkDomainAge = true
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Step(number: 1, text: "Åbn **Indstillinger** → **Apps** → **Safari** → **Udvidelser**.")
                    Step(number: 2, text: "Vælg **LinkTunnel** og slå den til.")
                    Step(number: 3, text: "Under **Tilladelser** skal **Alle websteder** stå til **Tillad**. Ellers kan LinkTunnel ikke se dine klik.")
                    Button("Åbn Indstillinger") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    }
                } header: {
                    Text("Pop-up ved klik i Safari")
                } footer: {
                    Text("Når du trykker på et link i Safari, viser LinkTunnel hvor det går hen, før siden åbnes. Indstillinger for udvidelsen finder du ved at trykke på puslespilsikonet i Safaris adresselinje.")
                }

                Section {
                    Step(number: 1, text: "Hold fingeren på et link i Mail, Beskeder eller en anden app.")
                    Step(number: 2, text: "Tryk **Del** og rul ned til **Tjek med LinkTunnel**.")
                    Step(number: 3, text: "Tip: Tryk **Rediger handlinger** nederst i Del-menuen og føj LinkTunnel til dine favoritter, så den ligger øverst.")
                } header: {
                    Text("Tjek links i andre apps")
                } footer: {
                    Text("iOS tillader ikke, at en app opsnapper klik i Mail og Beskeder. Del-menuen er den sikre vej rundt om det.")
                }

                Section {
                    Picker("Følg omdirigeringer", selection: $followRaw) {
                        ForEach(FollowMode.allCases) { mode in
                            Text(mode.title).tag(mode.rawValue)
                        }
                    }
                    Toggle("Tjek domænets alder", isOn: $checkDomainAge)
                } header: {
                    Text("Tjek i appen")
                } footer: {
                    Text("Omdirigeringer følges uden at åbne siden. Enkelte engangslinks kan blive brugt op af det, så som standard følges kun forkortede links (bit.ly mv.) og nyhedsbrev-links. Domænets alder slås op i det offentlige domæneregister via rdap.org – kun domænenavnet sendes. Safari-udvidelsen har sine egne indstillinger.")
                }

                Section("Om vurderingen") {
                    Text("LinkTunnel leder efter kendte svindeltricks: domæner der efterligner MitID, banker, PostNord og andre, falske bogstaver, skjulte destinationer, helt nye domæner og links hvor teksten ikke passer med adressen. Et grønt resultat betyder, at intet af det blev fundet – ikke at siden er garanteret sikker.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Opsætning")
        }
    }
}

private struct Step: View {
    let number: Int
    let text: LocalizedStringKey

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text("\(number)")
                .font(.footnote.bold())
                .foregroundStyle(.white)
                .frame(width: 22, height: 22)
                .background(Circle().fill(Color.accentColor))
            Text(text)
        }
    }
}
