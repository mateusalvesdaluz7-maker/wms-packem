import Foundation

struct StationError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
enum TagCodec {
    static let ntag213Version = Data([0x00, 0x04, 0x04, 0x02, 0x01, 0x00, 0x0F, 0x03])

    static func textPayload(_ text: String) throws -> Data {
        guard !text.isEmpty, text.utf8.count <= 120 else {
            throw StationError("O texto deve conter de 1 a 120 bytes para este projeto.")
        }
        return Data([0x02, 0x70, 0x74]) + Data(text.utf8) // UTF-8, idioma pt.
    }

    static func decodeText(_ payload: Data) throws -> String {
        let bytes = [UInt8](payload)
        guard let status = bytes.first, status & 0xC0 == 0 else {
            throw StationError("O registro não é um texto NDEF UTF-8 suportado.")
        }
        let start = 1 + Int(status & 0x3F)
        guard bytes.count >= start, let text = String(bytes: bytes.dropFirst(start), encoding: .utf8) else {
            throw StationError("Registro NDEF incompleto ou texto inválido.")
        }
        return text
    }

    // READ 00h devolve 16 bytes. O UID é reconstruído da memória efetivamente relida.
    static func uidFromPageZero(_ memory: Data) throws -> Data {
        let bytes = [UInt8](memory)
        guard bytes.count == 16,
              bytes[3] == (0x88 ^ bytes[0] ^ bytes[1] ^ bytes[2]),
              bytes[8] == (bytes[4] ^ bytes[5] ^ bytes[6] ^ bytes[7]) else {
            throw StationError("Não foi possível conferir o UID relido da tag.")
        }
        return Data([bytes[0], bytes[1], bytes[2], bytes[4], bytes[5], bytes[6], bytes[7]])
    }

    static func hex(_ data: Data) -> String { data.map { String(format: "%02X", $0) }.joined() }
}
