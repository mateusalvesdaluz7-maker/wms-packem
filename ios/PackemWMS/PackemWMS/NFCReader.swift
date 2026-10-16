import Foundation
import CoreNFC

/// UID de fábrica, sem escrita no chip: cada leitura aguarda o WMS.
@MainActor final class NFCReader: NSObject, NFCTagReaderSessionDelegate {
    var onReading: ((WMSBinding, String, String) async throws -> CountReceipt)?
    var onStop: ((WMSBinding, String) -> Void)?
    var onStatus: ((String) -> Void)?
    private var reader: NFCTagReaderSession?
    private var binding: WMSBinding?
    private var operation: Task<Void, Never>?
    private var lastUID: String?

    func start(_ binding: WMSBinding) {
        guard reader == nil, operation == nil else {
            onStop?(binding, "Aguarde o encerramento da sessão NFC anterior."); return
        }
        guard NFCTagReaderSession.readingAvailable,
              let session = NFCTagReaderSession(pollingOption: .iso14443, delegate: self, queue: .main) else {
            onStop?(binding, "NFC indisponível. É necessário um iPhone físico e um app assinado com a capacidade NFC."); return
        }
        self.binding = binding; reader = session; lastUID = nil
        session.alertMessage = binding.mode == .enroll ? "Aproxime uma NTAG213 para cadastrar seu UID. A memória não será alterada." : "Aproxime uma NTAG213 cadastrada no WMS. Uma por vez."
        onStatus?(binding.mode == .enroll ? "Cadastro NFC ativo. Aguarde a confirmação do WMS." : "Leitura NFC ativa. Aguarde a confirmação de cada embalagem.")
        session.begin()
    }

    func stop(_ message: String) {
        let old = binding, session = reader
        binding = nil; reader = nil; operation?.cancel()
        session?.invalidate()
        if let old = old { onStop?(old, message) }
        onStatus?(message)
    }

    func stop(matching value: WMSBinding) {
        if binding == value { stop("Leitura encerrada pelo WMS.") }
    }

    nonisolated func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

    nonisolated func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        Task { @MainActor in
            guard self.reader === session else { return }
            self.stop("Sessão NFC encerrada. Toque em Ler NFC para continuar. \(error.localizedDescription)")
        }
    }

    nonisolated func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        Task { @MainActor in
            guard self.reader === session, self.operation == nil else { return }
            guard tags.count == 1 else {
                session.alertMessage = "Mais de uma etiqueta detectada. Afaste as outras."
                self.operation = Task { @MainActor in await self.pollAgain(session) }
                return
            }
            self.operation = Task { @MainActor in await self.read(tags[0], session: session) }
        }
    }

    private func ensureActive(_ session: NFCTagReaderSession, _ binding: WMSBinding) throws {
        try Task.checkCancellation()
        guard reader === session, self.binding == binding else { throw StationError("A sessão de leitura mudou.") }
    }

    private func pollAgain(_ session: NFCTagReaderSession) async {
        defer { operation = nil }
        do {
            try await Task.sleep(nanoseconds: 700_000_000)
            guard reader === session else { return }
            session.restartPolling()
        } catch { /* A pausa cancela também a próxima varredura. */ }
    }

    private func read(_ target: NFCTag, session: NFCTagReaderSession) async {
        defer { operation = nil }
        guard let binding = binding else { return }
        do {
            try ensureActive(session, binding)
            try await session.connect(to: target)
            guard case let .miFare(tag) = target, tag.identifier.count == 7, tag.identifier.first == 0x04 else {
                throw StationError("Use uma etiqueta NTAG213 de 7 bytes de UID.")
            }
            let uid = TagCodec.hex(tag.identifier)
            if uid == lastUID {
                session.alertMessage = "Etiqueta já recebida. Afaste-a e aproxime a próxima."
            } else {
                guard try await tag.packemCommand([0x60]) == TagCodec.ntag213Version else {
                    throw StationError("A versão da tag não corresponde à NTAG213 suportada.")
                }
                let memory = try await tag.packemCommand([0x30, 0x00])
                guard try TagCodec.uidFromPageZero(memory) == tag.identifier else { throw StationError("A identidade da etiqueta mudou durante a leitura.") }
                try ensureActive(session, binding)
                guard let deliver = onReading else { throw StationError("O WMS não está conectado ao leitor.") }
                onStatus?("Conferindo a embalagem no WMS…")
                let receipt = try await deliver(binding, uid, "")
                try ensureActive(session, binding)
                if binding.mode == .enroll { stop(receipt.label); return }
                lastUID = uid
                onStatus?(receipt.label)
                session.alertMessage = String((receipt.label + "\nAfaste esta etiqueta e aproxime a próxima.").prefix(240))
            }
            try await Task.sleep(nanoseconds: 700_000_000)
            try ensureActive(session, binding)
            session.restartPolling()
        } catch {
            if reader === session {
                let message = String(error.localizedDescription.prefix(240))
                stop(message)
            }
        }
    }
}

private extension NFCMiFareTag {
    func packemCommand(_ bytes: [UInt8]) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            sendMiFareCommand(commandPacket: Data(bytes)) { data, error in
                if let error = error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: data) }
            }
        }
    }
}
