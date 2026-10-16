import Foundation
import CoreNFC

/// Grava tags vazias e conta etiquetas, sempre aguardando a confirmação do WMS.
@MainActor final class NFCReader: NSObject, NFCTagReaderSessionDelegate {
    var onReading: ((WMSBinding, String, String) async throws -> CountReceipt)?
    var onAuthorizeWriting: ((WMSBinding, String, String) async throws -> Void)?
    var onProgrammed: ((WMSBinding, String, String) async throws -> ProgramReceipt)?
    var onStop: ((WMSBinding, String) -> Void)?
    var onStatus: ((String) -> Void)?
    private var reader: NFCTagReaderSession?
    private var binding: WMSBinding?
    private var operation: Task<Void, Never>?
    private var lastUID: String?
    private var programmingContent: String?

    func start(_ binding: WMSBinding) {
        guard binding.mode == .count || binding.mode == .enroll else { return }
        begin(binding, content: nil)
    }

    func program(_ binding: WMSBinding, content: String) {
        guard binding.mode == .program, binding.target == "v-labels" else { return }
        do { _ = try TagCodec.textPayload(content) }
        catch { onStop?(binding, error.localizedDescription); return }
        begin(binding, content: content)
    }

    private func begin(_ binding: WMSBinding, content: String?) {
        guard reader == nil, operation == nil else {
            onStop?(binding, "Aguarde o encerramento da sessão NFC anterior."); return
        }
        guard NFCTagReaderSession.readingAvailable,
              let session = NFCTagReaderSession(pollingOption: .iso14443, delegate: self, queue: .main) else {
            onStop?(binding, "NFC indisponível. É necessário um iPhone físico e um app assinado com a capacidade NFC."); return
        }
        self.binding = binding; reader = session; lastUID = nil; programmingContent = content
        session.alertMessage = binding.mode == .program ? "Aproxime uma NTAG213 vazia. Mantenha-a parada até conferir a gravação." : binding.mode == .enroll ? "Aproxime uma NTAG213 para cadastrar seu UID. A memória não será alterada." : "Aproxime uma NTAG213 cadastrada no WMS. Uma por vez."
        onStatus?(binding.mode == .program ? "Aguardando uma tag vazia para gravar a embalagem selecionada." : binding.mode == .enroll ? "Cadastro NFC ativo. Aguarde a confirmação do WMS." : "Leitura NFC ativa. Aguarde a confirmação de cada embalagem.")
        session.begin()
    }

    func stop(_ message: String) {
        let old = binding, session = reader
        binding = nil; reader = nil; programmingContent = nil; operation?.cancel()
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
            self.stop("Sessão NFC encerrada. Se estava gravando, confira o conteúdo da tag antes de tentar novamente. \(error.localizedDescription)")
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
            if let content = programmingContent {
                try await programTag(tag, session: session, binding: binding, uid: uid, content: content)
                return
            }
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

    private func programTag(_ tag: NFCMiFareTag, session: NFCTagReaderSession, binding: WMSBinding, uid: String, content: String) async throws {
        guard try await tag.packemCommand([0x60]) == TagCodec.ntag213Version else {
            throw StationError("Use uma NTAG213 compatível com este gravador.")
        }
        let message = NFCNDEFMessage(records: [NFCNDEFPayload(format: .nfcWellKnown, type: Data([0x54]), identifier: Data(), payload: try TagCodec.textPayload(content))])
        let (status, capacity) = try await tag.packemNDEFStatus()
        guard status == .readWrite, message.length <= capacity else {
            throw StationError("A tag não está formatada para NDEF gravável ou não tem espaço. Use uma NTAG213 vazia e formatada; o app não desbloqueia nem formata chips.")
        }
        try await requireBlank(tag)
        try ensureActive(session, binding)
        guard let authorize = onAuthorizeWriting, let confirm = onProgrammed else { throw StationError("O WMS não está conectado ao gravador.") }
        try await authorize(binding, uid, content)
        try ensureActive(session, binding)
        // A consulta ao WMS pode demorar. Confira novamente a tag antes da escrita.
        try await requireBlank(tag)
        guard try TagCodec.uidFromPageZero(await tag.packemCommand([0x30, 0x00])) == tag.identifier else {
            throw StationError("A identidade da tag mudou antes da gravação.")
        }
        try ensureActive(session, binding)
        onStatus?("Gravando e relendo a tag. Mantenha o iPhone próximo.")
        do {
            try await tag.packemWrite(message)
            try ensureActive(session, binding)
            let readback = try await tag.packemRead()
            guard readback.records.count == 1, let record = readback.records.first,
                  record.typeNameFormat == .nfcWellKnown, record.type == Data([0x54]),
                  record.identifier.isEmpty, record.payload == message.records[0].payload,
                  try TagCodec.uidFromPageZero(await tag.packemCommand([0x30, 0x00])) == tag.identifier else {
                throw StationError("O texto ou o UID relido diverge do solicitado.")
            }
            try ensureActive(session, binding)
            let receipt = try await confirm(binding, uid, content)
            try ensureActive(session, binding)
            // Uma tentativa grava apenas uma tag. Não avança automaticamente para outra.
            self.binding = nil; reader = nil; programmingContent = nil
            session.alertMessage = receipt.label; session.invalidate(); onStatus?(receipt.label)
        } catch {
            throw StationError(error.localizedDescription + " A escrita pode ter ocorrido. Releia esta tag antes de reutilizá-la; não há confirmação de gravação.")
        }
    }

    private func requireBlank(_ tag: NFCMiFareTag) async throws {
        do {
            let message = try await tag.packemRead()
            guard message.records.allSatisfy({ $0.typeNameFormat == .empty && $0.type.isEmpty && $0.identifier.isEmpty && $0.payload.isEmpty }) else {
                throw StationError("Esta tag já contém dados. Use uma NTAG213 vazia para não substituir outra embalagem.")
            }
        } catch let error as NFCReaderError where error.code == .ndefReaderSessionErrorZeroLengthMessage {
            // NDEF formatado, ainda sem mensagem: permitido apenas após queryNDEFStatus.
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
    func packemRead() async throws -> NFCNDEFMessage {
        try await withCheckedThrowingContinuation { continuation in
            readNDEF { message, error in
                if let error = error { continuation.resume(throwing: error) }
                else if let message = message { continuation.resume(returning: message) }
                else { continuation.resume(throwing: StationError("A etiqueta não devolveu conteúdo NDEF.")) }
            }
        }
    }
    func packemNDEFStatus() async throws -> (NFCNDEFStatus, Int) {
        try await withCheckedThrowingContinuation { continuation in
            queryNDEFStatus { status, capacity, error in
                if let error = error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: (status, capacity)) }
            }
        }
    }
    func packemWrite(_ message: NFCNDEFMessage) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            writeNDEF(message) { error in
                if let error = error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: ()) }
            }
        }
    }
}
