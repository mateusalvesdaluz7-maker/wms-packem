import Foundation

enum WMSPolicy {
    static let production = URL(string: "https://wms-packem.vercel.app/")!
    static let preview = URL(string: "https://wms-packem-git-fork-testemateus458-alt-cod-e27b10-vercelcomdrop.vercel.app/")!
    static let targets = ["v-floor", "v-floor70", "v-recic"]

    static func allows(_ url: URL?) -> Bool {
        guard let url = url, url.scheme == "https", url.user == nil, url.password == nil,
              url.port == nil || url.port == 443 else { return false }
        return [production.host, preview.host].contains(url.host)
    }

    static func allowsOrigin(scheme: String, host: String, port: Int) -> Bool {
        scheme == "https" && (port == 0 || port == 443) && [production.host, preview.host].contains(host)
    }
}

enum NFCMode: String { case count, enroll, program }

struct WMSBinding: Equatable {
    let sessionID: String
    let target: String
    let mode: NFCMode

    init?(body: [String: Any]) {
        guard let id = body["sessionId"] as? String, UUID(uuidString: id) != nil,
              let target = body["target"] as? String,
              let mode = NFCMode(rawValue: body["mode"] as? String ?? "count"),
              (mode == .count && WMSPolicy.targets.contains(target)) || ((mode == .enroll || mode == .program) && target == "v-labels") else { return nil }
        self.sessionID = id; self.target = target; self.mode = mode
    }
}

struct ProgramReceipt {
    let label: String
    init(response: Any) throws {
        guard let value = response as? [String: Any], value["accepted"] as? Bool == true,
              let label = value["label"] as? String, !label.isEmpty, label.utf8.count <= 300 else {
            throw StationError("A gravação física pode ter ocorrido, mas o WMS não a confirmou. Releia a tag antes de reutilizá-la.")
        }
        self.label = label
    }
}

struct CountReceipt {
    let label: String
    let duplicate: Bool

    init(response: Any) throws {
        guard let value = response as? [String: Any], let accepted = value["accepted"] as? Bool, accepted,
              let label = value["label"] as? String, !label.isEmpty, label.utf8.count <= 300,
              let duplicate = value["duplicate"] as? Bool else {
            throw StationError("O WMS não confirmou a entrada. Confira a contagem antes de reapresentar a tag.")
        }
        self.label = label; self.duplicate = duplicate
    }
}
