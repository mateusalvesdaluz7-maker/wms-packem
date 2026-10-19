import SwiftUI
import WebKit

@main
struct PackemNFCApp: App {
    @StateObject private var browser = WMSBrowserController()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView(browser: browser)
                .onChange(of: scenePhase) { phase in
                    if phase == .background { browser.enteredBackground() }
                }
        }
    }
}

private struct PersistentWMSView: UIViewRepresentable {
    let browser: WMSBrowserController
    func makeUIView(context: Context) -> WKWebView { browser.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

struct ContentView: View {
    @ObservedObject var browser: WMSBrowserController
    @State private var showingSettings = false

    var body: some View {
        NavigationView {
            Group {
                if browser.configuration == nil {
                    ConfigurationForm(browser: browser, onSaved: {})
                } else {
                    VStack(spacing: 0) {
                        if browser.loading { ProgressView().progressViewStyle(.linear).padding(.horizontal) }
                        PersistentWMSView(browser: browser)
                        Text(browser.status).font(.caption).foregroundColor(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(10)
                            .background(Color(.secondarySystemBackground))
                    }
                }
            }
            .navigationTitle("Packem · WMS + NFC")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    if browser.configuration != nil {
                        Button { browser.reload() } label: { Image(systemName: "arrow.clockwise") }.accessibilityLabel("Recarregar WMS")
                        Button("Trocar URL") { browser.setSettingsOpen(true); showingSettings = true }
                    }
                }
            }
        }
        .navigationViewStyle(.stack)
        .sheet(isPresented: $showingSettings, onDismiss: { browser.setSettingsOpen(false) }) {
            NavigationView {
                ConfigurationForm(browser: browser, onSaved: { showingSettings = false; browser.setSettingsOpen(false) })
                    .navigationTitle("Configurar WMS")
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { showingSettings = false } } }
            }
        }
    }
}

private struct ConfigurationForm: View {
    @ObservedObject var browser: WMSBrowserController
    let onSaved: () -> Void
    @State private var text = ""
    @State private var errorMessage = ""

    var body: some View {
        Form {
            Section(header: Text("Endereço do seu WMS")) {
                TextField("https://seu-wms.exemplo", text: $text)
                    .keyboardType(.URL).textInputAutocapitalization(.never).disableAutocorrection(true)
                    .accessibilityLabel("URL HTTPS do WMS")
                Text("Informe o endereço HTTPS real que você usa no WMS. O app não inclui servidor, login ou credenciais.")
                    .font(.footnote).foregroundColor(.secondary)
            }
            Section {
                Button("Salvar URL e abrir WMS") {
                    do { try browser.configure(text); errorMessage = ""; onSaved() }
                    catch { errorMessage = error.localizedDescription }
                }
                if !errorMessage.isEmpty { Text(errorMessage).foregroundColor(.red) }
            }
            Section(header: Text("Como a leitura funciona")) {
                Text("Entre no WMS normalmente e toque no controle de leitura NFC. Aproxime uma única tag da parte superior do iPhone.")
                Text("A ponte só funciona na origem HTTPS configurada, na página principal. Links externos abrem no Safari por ação do usuário, sem NFC.")
                Text("UID não comprova identidade. O login e as validações do WMS continuam necessários.")
            }.font(.footnote)
            if !browser.status.isEmpty { Section { Text(browser.status).font(.footnote).foregroundColor(.secondary) } }
        }
        .onAppear { text = browser.configuredURLText }
    }
}
