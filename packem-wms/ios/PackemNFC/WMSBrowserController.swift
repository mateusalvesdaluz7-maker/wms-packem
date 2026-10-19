import Foundation
import SwiftUI
import UIKit
import WebKit

final class WMSBrowserController: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    static let settingsKey = "packem.wms.https-url.v1"
    @Published private(set) var configuration: WMSConfiguration?
    @Published private(set) var status = "Configure a URL HTTPS do WMS."
    @Published private(set) var loading = false
    let webView: WKWebView
    private let reader = NFCReader()
    private var navigationEpoch: UInt = 0
    private var committedAllowedDocument = false
    private var documentReady = false
    private var settingsOpen = false
    private var pending: Pending?

    private struct Context {
        let frame: WKFrameInfo
        let origin: WMSOrigin
        let epoch: UInt
    }
    private struct Pending {
        let requestId: String
        let token: UUID
        let context: Context
    }

    override init() {
        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.websiteDataStore = .default()
        webConfiguration.preferences.javaScriptCanOpenWindowsAutomatically = false
        webConfiguration.defaultWebpagePreferences.allowsContentJavaScript = true
        webView = WKWebView(frame: .zero, configuration: webConfiguration)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.configuration.userContentController.add(self, name: "packemNFC")
        reader.onStatus = { [weak self] in self?.status = $0 }
        if let saved = UserDefaults.standard.string(forKey: Self.settingsKey) {
            do {
                configuration = try WMSConfiguration.parse(saved)
                status = "Abrindo o WMS configurado…"
                webView.load(URLRequest(url: configuration!.url))
            } catch { status = "A URL salva é inválida. Configure novamente: \(error.localizedDescription)" }
        }
    }

    var configuredURLText: String { configuration?.url.absoluteString ?? UserDefaults.standard.string(forKey: Self.settingsKey) ?? "" }

    func configure(_ input: String) throws {
        let parsed = try WMSConfiguration.parse(input)
        clearPending()
        webView.stopLoading()
        navigationEpoch &+= 1
        committedAllowedDocument = false; documentReady = false
        configuration = parsed
        UserDefaults.standard.set(parsed.url.absoluteString, forKey: Self.settingsKey)
        status = "URL salva. Abrindo o WMS com validação de origem…"
        webView.load(URLRequest(url: parsed.url))
    }

    func reload() { clearPending(); webView.reload() }
    func setSettingsOpen(_ open: Bool) {
        settingsOpen = open
        if open { clearPending(); status = "Leitura NFC suspensa enquanto a configuração está aberta." }
    }
    func enteredBackground() {
        clearPending()
        status = "Leitura NFC encerrada ao sair do aplicativo. Toque em ler novamente no WMS."
    }

    private func clearPending() {
        pending = nil
        reader.cancel(silently: true)
    }

    private func beginNavigation() {
        clearPending()
        navigationEpoch &+= 1
        committedAllowedDocument = false; documentReady = false
        loading = true
    }

    private func context(for frame: WKFrameInfo) -> Context? {
        guard let origin = configuration?.origin, frame.isMainFrame,
              origin.matches(scheme: frame.securityOrigin.protocol, host: frame.securityOrigin.host, port: frame.securityOrigin.port),
              origin.matches(url: frame.request.url), origin.matches(url: webView.url), committedAllowedDocument else { return nil }
        return Context(frame: frame, origin: origin, epoch: navigationEpoch)
    }

    private func canDeliver(_ context: Context) -> Bool {
        guard committedAllowedDocument, !settingsOpen, UIApplication.shared.applicationState == .active,
              context.epoch == navigationEpoch, context.origin == configuration?.origin,
              context.frame.isMainFrame, context.origin.matches(url: context.frame.request.url),
              context.origin.matches(scheme: context.frame.securityOrigin.protocol, host: context.frame.securityOrigin.host, port: context.frame.securityOrigin.port),
              context.origin.matches(url: webView.url) else { return false }
        return true
    }

    private func deliver(_ result: NFCResult, requestId: String, context: Context) {
        guard canDeliver(context), let data = try? result.jsonData(requestId: requestId),
              let payloadJSON = String(data: data, encoding: .utf8) else { return }
        // Texto da tag é argumento de dados serializados, jamais código interpolado.
        let script = """
        if (window !== window.top || window.location.origin !== expectedOrigin) return false;
        const result = JSON.parse(payloadJSON);
        if (window.PackemNFC && typeof window.PackemNFC.receive === 'function') {
            window.PackemNFC.receive(result);
            return true;
        }
        return false;
        """
        webView.callAsyncJavaScript(script,
            arguments: ["payloadJSON": payloadJSON, "expectedOrigin": context.origin.browserOrigin],
            in: context.frame, in: .page) { _ in /* Frame expirado: descarta, sem redirecionar callback. */ }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "packemNFC", message.webView === webView,
              let context = context(for: message.frameInfo) else { return }
        let request: BridgeRequest
        do { request = try BridgeRequest.parse(message.body) }
        catch {
            status = error.localizedDescription
            if let body = message.body as? [String: Any], let requestId = BridgeRequest.validRequestId(body["requestId"]) {
                deliver(NFCResult(status: .error, text: "", message: error.localizedDescription), requestId: requestId, context: context)
            }
            return
        }
        guard !settingsOpen, UIApplication.shared.applicationState == .active else {
            deliver(NFCResult(status: .error, text: "", message: "Abra o WMS no aplicativo e feche a configuração antes de ler NFC."), requestId: request.requestId, context: context)
            return
        }
        switch request.action {
        case .cancel:
            guard pending?.requestId == request.requestId else {
                deliver(NFCResult(status: .error, text: "", message: "Não existe leitura NFC ativa com este requestId."), requestId: request.requestId, context: context); return
            }
            reader.cancel(silently: false)
        case .scan(let mode):
            guard documentReady else {
                deliver(NFCResult(status: .error, text: "", message: "O WMS ainda está carregando. Aguarde e tente novamente."), requestId: request.requestId, context: context); return
            }
            guard pending == nil else {
                deliver(NFCResult(status: .error, text: "", message: "Já existe uma leitura NFC ativa. Cancele ou conclua a anterior."), requestId: request.requestId, context: context); return
            }
            let token = UUID()
            pending = Pending(requestId: request.requestId, token: token, context: context)
            reader.start(mode: mode) { [weak self] result in
                guard let self = self, let pending = self.pending, pending.token == token else { return }
                self.pending = nil
                self.deliver(result, requestId: pending.requestId, context: pending.context)
            }
        }
    }

    private func handleNewWindow(_ action: WKNavigationAction) {
        guard action.navigationType == .linkActivated, let url = action.request.url,
              let externalOrigin = try? WMSOrigin(url: url) else { return }
        if externalOrigin == configuration?.origin {
            webView.load(action.request)
        } else {
            clearPending()
            // Somente um link acionado pelo usuário pode sair para o Safari.
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
            status = "Link externo aberto no Safari, sem ponte NFC."
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame == nil {
            handleNewWindow(navigationAction); decisionHandler(.cancel); return
        }
        if navigationAction.targetFrame?.isMainFrame == true {
            guard configuration?.origin.matches(url: url) == true else {
                clearPending()
                if navigationAction.navigationType == .linkActivated { handleNewWindow(navigationAction) }
                else { status = "Navegação bloqueada: a página deve permanecer na origem HTTPS configurada." }
                decisionHandler(.cancel); return
            }
            beginNavigation()
        } else if url.scheme?.lowercased() != "https" {
            // Não permite subframes HTTP, file:, javascript: ou esquemas customizados.
            decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.isForMainFrame, configuration?.origin.matches(url: navigationResponse.response.url) != true {
            clearPending(); committedAllowedDocument = false; documentReady = false; loading = false
            status = "Redirecionamento bloqueado: destino fora da origem HTTPS configurada."
            decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { beginNavigation() }
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        committedAllowedDocument = configuration?.origin.matches(url: webView.url) == true
        documentReady = false
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading = false
        committedAllowedDocument = configuration?.origin.matches(url: webView.url) == true
        documentReady = committedAllowedDocument
        status = documentReady ? "WMS aberto. A leitura NFC é iniciada pelos controles do WMS." : "Origem não autorizada para NFC."
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { navigationFailed() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { navigationFailed() }
    private func navigationFailed() {
        clearPending(); loading = false; committedAllowedDocument = false; documentReady = false
        status = "Não foi possível abrir o WMS. Confira URL, conexão e certificado HTTPS. Nenhuma exceção TLS será aplicada."
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        navigationFailed(); status = "A página foi encerrada pelo iOS. Recarregue o WMS para continuar."
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
}
