import SwiftUI
import WebKit

@MainActor final class WMSModel: ObservableObject {
    @Published var status = "Entre com seu usuário do WMS e abra a contagem."
    @Published var loading = true
    let webView: WKWebView
    let reader = NFCReader()

    init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
    }

    func open(_ url: URL) {
        guard WMSPolicy.allows(url) else { return }
        reader.stop("Leitura encerrada ao trocar a página.")
        webView.load(URLRequest(url: url))
    }
}

@MainActor struct WMSWebView: UIViewRepresentable {
    @ObservedObject var model: WMSModel
    func makeCoordinator() -> Coordinator { Coordinator(model: model) }
    func makeUIView(context: Context) -> WKWebView {
        let web = model.webView
        web.navigationDelegate = context.coordinator
        web.configuration.userContentController.add(context.coordinator, name: "packemNfc")
        context.coordinator.attach()
        model.open(WMSPolicy.preview)
        return web
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        coordinator.model.reader.stop("Leitura encerrada ao fechar o WMS.")
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "packemNfc")
        uiView.navigationDelegate = nil
    }

    @MainActor final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let model: WMSModel
        init(model: WMSModel) { self.model = model }

        func attach() {
            model.reader.onStatus = { [weak self] status in self?.model.status = status }
            model.reader.onStop = { [weak self] binding, message in self?.notifyStopped(binding, message) }
            model.reader.onReading = { [weak self] binding, uid, text in
                guard let self = self, WMSPolicy.allows(self.model.webView.url) else { throw StationError("A página do WMS mudou.") }
                let payload: [String: Any] = ["sessionId": binding.sessionID, "target": binding.target, "uid": uid, "content": text]
                let response = try await self.call("if (!window.PackemWmsApp) throw new Error('Integração NFC não publicada nesta página.'); return await window.PackemWmsApp.receive(reading);", arguments: ["reading": payload])
                return try CountReceipt(response: response)
            }
            model.reader.onAuthorizeWriting = { [weak self] binding, uid, text in
                guard let self = self, WMSPolicy.allows(self.model.webView.url) else { throw StationError("A página do WMS mudou.") }
                let payload: [String: Any] = ["sessionId": binding.sessionID, "target": binding.target, "uid": uid, "content": text]
                let response = try await self.call("if (!window.PackemWmsApp) throw new Error('Integração NFC não publicada.'); return await window.PackemWmsApp.authorizeWriting(reading);", arguments: ["reading": payload])
                guard let value = response as? [String: Any], value["accepted"] as? Bool == true else {
                    throw StationError("O WMS não autorizou a gravação desta tag.")
                }
            }
            model.reader.onProgrammed = { [weak self] binding, uid, text in
                guard let self = self, WMSPolicy.allows(self.model.webView.url) else { throw StationError("A página do WMS mudou.") }
                let payload: [String: Any] = ["sessionId": binding.sessionID, "target": binding.target, "uid": uid, "content": text]
                let response = try await self.call("if (!window.PackemWmsApp) throw new Error('Integração NFC não publicada.'); return await window.PackemWmsApp.programmed(reading);", arguments: ["reading": payload])
                return try ProgramReceipt(response: response)
            }
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            let origin = message.frameInfo.securityOrigin
            guard message.name == "packemNfc", message.webView === model.webView, message.frameInfo.isMainFrame,
                  WMSPolicy.allows(model.webView.url),
                  WMSPolicy.allowsOrigin(scheme: origin.protocol, host: origin.host, port: origin.port),
                  origin.host == model.webView.url?.host,
                  let body = message.body as? [String: Any], let type = body["type"] as? String,
                  let binding = WMSBinding(body: body) else { return }
            if type == "start" { model.reader.start(binding) }
            else if type == "program", let content = body["content"] as? String { model.reader.program(binding, content: content) }
            else if type == "stop" { model.reader.stop(matching: binding) }
        }

        private func call(_ body: String, arguments: [String: Any]) async throws -> Any {
            try await withCheckedThrowingContinuation { continuation in
                // Uma consulta de rede travada não pode bloquear a antena indefinidamente.
                var completed = false
                let timeout = Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 12_000_000_000)
                    guard !completed else { return }
                    completed = true
                    continuation.resume(throwing: StationError("O WMS não confirmou em 12 segundos. Confira a contagem ou o conteúdo físico da tag antes de repetir a operação."))
                }
                model.webView.callAsyncJavaScript(body, arguments: arguments, in: nil, in: .page) { result in
                    guard !completed else { return }
                    completed = true; timeout.cancel()
                    continuation.resume(with: result)
                }
            }
        }

        private func notifyStopped(_ binding: WMSBinding, _ message: String) {
            guard WMSPolicy.allows(model.webView.url) else { return }
            model.webView.callAsyncJavaScript("window.PackemWmsApp?.stopped(sessionId, message);", arguments: ["sessionId": binding.sessionID, "message": message], in: nil, in: .page) { _ in }
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard WMSPolicy.allows(navigationAction.request.url) else { decisionHandler(.cancel); return }
            // Não navega para um segundo contexto/iframe com acesso à antena.
            guard navigationAction.targetFrame?.isMainFrame == true else { decisionHandler(.cancel); return }
            model.reader.stop("Leitura encerrada ao navegar. Abra a contagem e toque em Ler NFC.")
            decisionHandler(.allow)
        }
        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { model.loading = true }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            model.loading = false; model.status = "Em Gestão de Etiquetas, prepare e grave uma tag vazia. Na contagem, toque em Ler NFC."
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            model.loading = false; model.status = "Não foi possível abrir o WMS: \(error.localizedDescription)"
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            model.loading = false; model.status = "Falha ao carregar o WMS: \(error.localizedDescription)"
        }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            model.reader.stop("O WMS foi interrompido. Reabra a página e confira os itens já contados.")
            model.loading = false
        }
    }
}
