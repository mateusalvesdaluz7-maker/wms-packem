import CoreNFC
import Foundation

enum NDEFDecoder {
    static func decode(_ message: NFCNDEFMessage) throws -> String {
        let encodedBytes = message.records.reduce(0) { $0 + $1.payload.count }
        guard encodedBytes <= NFCContentRules.maximumBytes else { throw PackemError("A mensagem NFC excede 2048 bytes de payload.") }
        let values: [String] = try message.records.map { record in
            guard record.typeNameFormat == .nfcWellKnown else { throw PackemError("Formato NDEF desconhecido; use registro Text T ou URI U.") }
            if record.type == Data([0x54]) {
                try NFCContentRules.validateTextPayload(record.payload)
                let (text, _) = record.wellKnownTypeTextPayload()
                guard let text = text else { throw PackemError("Não foi possível decodificar o texto NFC UTF-8/UTF-16 e seu idioma.") }
                return text
            }
            if record.type == Data([0x55]) {
                guard record.payload.count > 1,
                      String(data: Data(record.payload.dropFirst()), encoding: .utf8) != nil,
                      let uri = record.wellKnownTypeURIPayload() else { throw PackemError("Registro URI NDEF inválido ou vazio.") }
                return uri.absoluteString
            }
            throw PackemError("Registro NDEF desconhecido; somente Text T e URI U são aceitos.")
        }
        return try NFCContentRules.uniqueContent(values)
    }
}
