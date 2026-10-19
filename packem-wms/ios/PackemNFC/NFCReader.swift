import CoreNFC
import Foundation

final class NFCReader: NSObject, NFCTagReaderSessionDelegate {
    private var session: NFCTagReaderSession?
    private var completion: ((NFCResult) -> Void)?
    private var mode: NFCMode = .ndef
    private var connecting = false
    var onStatus: ((String) -> Void)?

    func start(mode: NFCMode, completion: @escaping (NFCResult) -> Void) {
        precondition(Thread.isMainThread)
        guard session == nil else {
            completion(NFCResult(status: .error, text: "", message: "Já existe uma leitura NFC ativa.")); return
        }
        guard NFCTagReaderSession.readingAvailable else {
            completion(NFCResult(status: .error, text: "", message: "A leitura NFC não está disponível neste aparelho. Use um iPhone compatível; o simulador não lê tags.")); return
        }
        guard let created = NFCTagReaderSession(pollingOption: [.iso14443, .iso15693], delegate: self, queue: .main) else {
            completion(NFCResult(status: .error, text: "", message: "Não foi possível criar a sessão NFC. Confira aparelho, assinatura e capability NFC.")); return
        }
        self.mode = mode; self.completion = completion; session = created; connecting = false
        created.alertMessage = "Aproxime a parte superior do iPhone de uma única tag do WMS."
        onStatus?("Aguardando aproximação NFC…")
        created.begin()
    }

    func cancel(silently: Bool) {
        precondition(Thread.isMainThread)
        if silently {
            let previous = session; session = nil; completion = nil; connecting = false; previous?.invalidate()
        } else if session != nil {
            finish(NFCResult(status: .cancelled, text: "", message: "Leitura NFC cancelada."))
        }
    }

    private func finish(_ result: NFCResult) {
        precondition(Thread.isMainThread)
        guard let previous = session else { return }
        let callback = completion
        // Limpa antes de invalidar: didInvalidate não pode emitir callback duplo.
        session = nil; completion = nil; connecting = false
        if result.status == .error { previous.invalidate(errorMessage: result.message) }
        else { previous.alertMessage = result.message; previous.invalidate() }
        onStatus?(result.message); callback?(result)
    }

    func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {
        guard self.session === session else { return }
        onStatus?("NFC ativo. Aproxime uma tag.")
    }

    func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        guard self.session === session else { return }
        let callback = completion
        self.session = nil; completion = nil; connecting = false
        let code = (error as? NFCReaderError)?.code
        let result: NFCResult
        switch code {
        case .readerSessionInvalidationErrorUserCanceled:
            result = NFCResult(status: .cancelled, text: "", message: "Leitura NFC cancelada pelo usuário.")
        case .readerSessionInvalidationErrorSessionTimeout:
            result = NFCResult(status: .error, text: "", message: "O tempo da leitura NFC terminou. Toque em ler novamente e aproxime a tag.")
        case .readerErrorSecurityViolation:
            result = NFCResult(status: .error, text: "", message: "NFC não autorizado. Confira permissão, assinatura e a capability NFC do aplicativo.")
        case .readerSessionInvalidationErrorSystemIsBusy:
            result = NFCResult(status: .error, text: "", message: "O leitor NFC está ocupado. Feche outra leitura e tente novamente.")
        case .readerErrorUnsupportedFeature:
            result = NFCResult(status: .error, text: "", message: "Este aparelho não oferece a leitura NFC solicitada.")
        default:
            result = NFCResult(status: .error, text: "", message: "A sessão NFC foi interrompida. Confira se o aplicativo está aberto e tente novamente.")
        }
        onStatus?(result.message); callback?(result)
    }

    func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        guard self.session === session, !connecting else { return }
        guard tags.count == 1, let detected = tags.first else {
            session.alertMessage = "Mais de uma tag detectada. Afaste todas e aproxime somente uma."
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self, weak session] in
                guard let session = session, self?.session === session else { return }; session.restartPolling()
            }
            return
        }
        connecting = true
        session.connect(to: detected) { [weak self, weak session] error in
            DispatchQueue.main.async {
                guard let self = self, let session = session, self.session === session else { return }
                guard error == nil else { self.finish(NFCResult(status: .error, text: "", message: "Não foi possível conectar à tag. Mantenha-a próxima e tente novamente.")); return }
                self.read(detected, in: session)
            }
        }
    }

    private func read(_ detected: NFCTag, in session: NFCTagReaderSession) {
        let tag: any NFCNDEFTag
        let identifier: Data
        switch detected {
        case .miFare(let value): tag = value; identifier = value.identifier
        case .iso7816(let value): tag = value; identifier = value.identifier
        case .iso15693(let value): tag = value; identifier = value.identifier
        default:
            finish(NFCResult(status: .error, text: "", message: "Família de tag não suportada. Use tag compatível ISO 14443 ou ISO 15693.")); return
        }
        let uid: String
        do { uid = try NFCContentRules.hexIdentifier(identifier) }
        catch { finish(NFCResult(status: .error, text: "", message: error.localizedDescription)); return }
        if mode == .uid {
            finish(NFCResult(status: .read, text: uid, message: "UID NFC lido. O identificador não é autenticação.", uid: uid)); return
        }
        tag.queryNDEFStatus { [weak self, weak session] status, _, error in
            DispatchQueue.main.async {
                guard let self = self, let session = session, self.session === session else { return }
                guard error == nil, status == .readOnly || status == .readWrite else {
                    self.finish(NFCResult(status: .error, text: "", message: "A tag não oferece conteúdo NDEF legível. O UID não será usado como substituição.")); return
                }
                tag.readNDEF { [weak self, weak session] message, error in
                    DispatchQueue.main.async {
                        guard let self = self, let session = session, self.session === session else { return }
                        guard error == nil, let message = message else {
                            self.finish(NFCResult(status: .error, text: "", message: "Não foi possível ler o conteúdo NDEF. Aproxime a tag e tente novamente.")); return
                        }
                        do {
                            let text = try NDEFDecoder.decode(message)
                            self.finish(NFCResult(status: .read, text: text, message: "Conteúdo NFC lido e enviado ao WMS para validação.", uid: uid))
                        } catch { self.finish(NFCResult(status: .error, text: "", message: error.localizedDescription)) }
                    }
                }
            }
        }
    }
}
