import Foundation

struct PackemError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

struct WMSOrigin: Equatable {
    let host: String
    let port: Int

    init(url: URL) throws {
        guard url.scheme?.lowercased() == "https", let host = url.host?.lowercased(), !host.isEmpty,
              url.user == nil, url.password == nil else {
            throw PackemError("Informe uma URL HTTPS válida do WMS, sem usuário ou senha na URL.")
        }
        let port = url.port ?? 443
        guard (1...65535).contains(port) else { throw PackemError("A porta HTTPS deve estar entre 1 e 65535.") }
        self.host = host
        self.port = port
    }

    var browserOrigin: String {
        var components = URLComponents()
        components.scheme = "https"
        components.host = host
        if port != 443 { components.port = port }
        return components.url!.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    func matches(url: URL?) -> Bool {
        guard let url = url, let other = try? WMSOrigin(url: url) else { return false }
        return self == other
    }

    func matches(scheme: String, host: String, port: Int) -> Bool {
        scheme.lowercased() == "https" && host.lowercased() == self.host && (port == 0 ? 443 : port) == self.port
    }
}

struct WMSConfiguration {
    let url: URL
    let origin: WMSOrigin

    static func parse(_ input: String) throws -> WMSConfiguration {
        let cleaned = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty, !cleaned.contains(where: { $0.isWhitespace }),
              let parts = URLComponents(string: cleaned), let url = parts.url else {
            throw PackemError("Informe a URL HTTPS completa do seu WMS, sem espaços.")
        }
        let origin = try WMSOrigin(url: url)
        return WMSConfiguration(url: url, origin: origin)
    }
}

enum NFCMode: String { case ndef, uid }
enum BridgeAction { case scan(NFCMode), cancel }

struct BridgeRequest {
    let requestId: String
    let action: BridgeAction

    static func validRequestId(_ value: Any?) -> String? {
        guard let value = value as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              value.utf16.count <= 120 else { return nil }
        return value
    }

    static func parse(_ body: Any) throws -> BridgeRequest {
        guard let body = body as? [String: Any], let requestId = validRequestId(body["requestId"]),
              let action = body["action"] as? String else {
            throw PackemError("Pedido NFC inválido: informe action e requestId textual não vazio, com até 120 caracteres.")
        }
        if action == "scan" {
            guard Set(body.keys) == Set(["action", "requestId", "mode"]),
                  let modeText = body["mode"] as? String, let mode = NFCMode(rawValue: modeText) else {
                throw PackemError("Modo NFC inválido. Use ndef ou uid, sem campos adicionais.")
            }
            return BridgeRequest(requestId: requestId, action: .scan(mode))
        }
        if action == "cancel", Set(body.keys) == Set(["action", "requestId"]) {
            return BridgeRequest(requestId: requestId, action: .cancel)
        }
        throw PackemError("Ação NFC inválida. Use scan ou cancel com os campos previstos.")
    }
}

enum NFCResultStatus: String { case read, cancelled, error }
struct NFCResult {
    let status: NFCResultStatus
    let text: String
    let message: String
    var uid: String? = nil

    func jsonData(requestId: String) throws -> Data {
        var object: [String: Any] = ["requestId": requestId, "status": status.rawValue, "text": text, "message": message]
        if let uid = uid { object["uid"] = uid }
        return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }
}

enum NFCContentRules {
    static let maximumBytes = 2048

    static func uniqueContent(_ values: [String]) throws -> String {
        guard !values.isEmpty else { throw PackemError("A tag não contém texto ou URI NDEF reconhecido.") }
        for value in values {
            guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw PackemError("O conteúdo NFC está vazio.") }
            guard value.utf8.count <= maximumBytes else { throw PackemError("O conteúdo NFC excede 2048 bytes.") }
        }
        guard Set(values).count == 1 else { throw PackemError("A tag contém conteúdos diferentes e ambíguos. Use uma tag com um único valor.") }
        return values[0]
    }

    static func validateTextPayload(_ payload: Data) throws {
        guard let status = payload.first, status & 0x40 == 0 else { throw PackemError("Registro de texto NDEF inválido.") }
        let languageLength = Int(status & 0x3F)
        let textStart = 1 + languageLength
        guard payload.count > textStart else { throw PackemError("Registro de texto NDEF vazio ou com idioma inválido.") }
        let text = Data(payload.dropFirst(textStart))
        let utf16 = status & 0x80 != 0
        if utf16 {
            guard text.count % 2 == 0 else { throw PackemError("Texto NFC UTF-16 incompleto.") }
        } else if String(data: text, encoding: .utf8) == nil {
            throw PackemError("Texto NFC UTF-8 inválido.")
        }
    }

    static func hexIdentifier(_ data: Data) throws -> String {
        guard !data.isEmpty else { throw PackemError("A tag não informou um identificador UID válido.") }
        return data.map { String(format: "%02X", $0) }.joined()
    }
}
