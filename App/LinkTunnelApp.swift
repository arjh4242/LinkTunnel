import SwiftUI

@main
struct LinkTunnelApp: App {
    @StateObject private var model = CheckModel()
    @State private var tab: AppTab = .check
    @State private var input = ""

    enum AppTab { case check, setup }

    var body: some Scene {
        WindowGroup {
            TabView(selection: $tab) {
                CheckView(model: model, input: $input)
                    .tabItem { Label("Tjek link", systemImage: "link") }
                    .tag(AppTab.check)
                SetupView()
                    .tabItem { Label("Opsætning", systemImage: "gearshape") }
                    .tag(AppTab.setup)
            }
            // linktunnel://check?url=https://… – praktisk fra Genveje (Shortcuts)
            .onOpenURL { url in
                guard url.scheme == "linktunnel",
                      let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                      let link = components.queryItems?.first(where: { $0.name == "url" })?.value else { return }
                tab = .check
                input = link
                model.check(link)
            }
        }
    }
}
