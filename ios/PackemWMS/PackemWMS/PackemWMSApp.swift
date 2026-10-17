import SwiftUI

@main @MainActor struct PackemWMSApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}

@MainActor struct ContentView: View {
    @StateObject private var model = WMSModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "wave.3.right.circle.fill").foregroundColor(.green)
                Text("Packem WMS").font(.headline)
                Spacer()
                Menu {
                    Button("Prévia de teste") { model.open(WMSPolicy.preview) }
                    Button("Ensaio sem estoque real") { model.open(WMSPolicy.preview.appendingPathComponent("tests/ui/nfc-app.html")) }
                    Button("WMS de produção") { model.open(WMSPolicy.production) }
                    Button("Recarregar") { if let url = model.webView.url { model.open(url) } }
                    Button("Parar NFC", role: .destructive) { model.reader.stop("Leitura encerrada pelo usuário.") }
                } label: { Image(systemName: "ellipsis.circle").font(.title2).accessibilityLabel("Opções do WMS") }
            }.padding(.horizontal).padding(.vertical, 10)
            if model.loading { ProgressView().progressViewStyle(.linear) }
            WMSWebView(model: model)
            Text(model.status).font(.caption).frame(maxWidth: .infinity, alignment: .leading).padding(10).background(Color.green.opacity(0.08)).accessibilityAddTraits(.updatesFrequently)
        }
        .onChange(of: scenePhase) { phase in
            if phase == .background { model.reader.stop("Leitura encerrada ao sair do aplicativo. Toque em Ler NFC ao voltar.") }
        }
    }
}
