import XCTest
import CoreNFC
@testable import PackemNFC

// FONTES DE TESTE; NÃO EXECUTADAS no Windows. Rodar com Product > Test no Xcode.
final class BridgeHelpersTests: XCTestCase {
    func testHTTPSAndExactOrigin() throws {
        let base = try WMSConfiguration.parse("https://wms.example.test/packem?view=stock")
        XCTAssertEqual(base.origin.browserOrigin, "https://wms.example.test")
        XCTAssertTrue(base.origin.matches(url: URL(string: "https://wms.example.test:443/outro")))
        XCTAssertFalse(base.origin.matches(url: URL(string: "https://wms.example.test.evil.test/")))
        XCTAssertFalse(base.origin.matches(url: URL(string: "https://sub.wms.example.test/")))
        XCTAssertFalse(base.origin.matches(url: URL(string: "https://wms.example.test:8443/")))
        XCTAssertFalse(base.origin.matches(url: URL(string: "http://wms.example.test/")))
        XCTAssertEqual(try WMSConfiguration.parse("https://wms.example.test:8443").origin.browserOrigin, "https://wms.example.test:8443")
        for invalid in ["", "http://wms.example.test", "file:///tmp/wms", "javascript:alert(1)", "https://user:secret@wms.example.test", "https://", "https://wms.example.test/a b"] {
            XCTAssertThrowsError(try WMSConfiguration.parse(invalid), invalid)
        }
    }

    func testBridgeRequestIsStrict() throws {
        let valid = try BridgeRequest.parse(["action": "scan", "requestId": "req-1", "mode": "ndef"])
        XCTAssertEqual(valid.requestId, "req-1")
        if case .scan(.ndef) = valid.action {} else { XCTFail("Modo incorreto") }
        _ = try BridgeRequest.parse(["action": "scan", "requestId": "req-2", "mode": "uid"])
        _ = try BridgeRequest.parse(["action": "cancel", "requestId": "req-1"])
        let invalid: [Any] = [
            ["action": "scan", "requestId": "", "mode": "ndef"],
            ["action": "scan", "requestId": String(repeating: "x", count: 121), "mode": "ndef"],
            ["action": "scan", "requestId": "a", "mode": ["ndef"]],
            ["action": "SCAN", "requestId": "a", "mode": "ndef"],
            ["action": "scan", "requestId": "a", "mode": "NDEF"],
            ["action": "cancel", "requestId": "a", "mode": "ndef"],
            ["action": "scan", "requestId": "a", "mode": "ndef", "url": "https://evil.test"],
            ["action": "scan", "requestId": 12, "mode": "ndef"],
            []
        ]
        for body in invalid { XCTAssertThrowsError(try BridgeRequest.parse(body)) }
    }

    func testUIDAndSafeJSONRoundTrip() throws {
        XCTAssertEqual(try NFCContentRules.hexIdentifier(Data([0, 10, 255, 127])), "000AFF7F")
        XCTAssertThrowsError(try NFCContentRules.hexIdentifier(Data()))
        let text = "'\"\\\n</script>\u{2028}window.location='https://evil.test'"
        let result = NFCResult(status: .read, text: text, message: "Conteúdo lido", uid: "AB01")
        let data = try result.jsonData(requestId: "req-1")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["text"] as? String, text)
        XCTAssertEqual(object["status"] as? String, "read")
        XCTAssertEqual(object["uid"] as? String, "AB01")
    }

    private func textRecord(_ text: String) -> NFCNDEFPayload {
        NFCNDEFPayload(format: .nfcWellKnown, type: Data([0x54]), identifier: Data(), payload: Data([0x02, 0x70, 0x74]) + Data(text.utf8))
    }

    func testTextUTF8AndURIUsingAppleAPI() throws {
        XCTAssertEqual(try NDEFDecoder.decode(NFCNDEFMessage(records: [textRecord("SKU-001")])), "SKU-001")
        let uri = NFCNDEFPayload(format: .nfcWellKnown, type: Data([0x55]), identifier: Data(), payload: Data([0x04]) + Data("example.test/item/01".utf8))
        XCTAssertEqual(try NDEFDecoder.decode(NFCNDEFMessage(records: [uri])), "https://example.test/item/01")
    }

    func testTextUTF16AndLanguageLength() throws {
        let utf16 = NFCNDEFPayload(format: .nfcWellKnown, type: Data([0x54]), identifier: Data(), payload: Data([0x82, 0x70, 0x74, 0xFE, 0xFF, 0x00, 0x50, 0x00, 0x31]))
        XCTAssertEqual(try NDEFDecoder.decode(NFCNDEFMessage(records: [utf16])), "P1")
        XCTAssertThrowsError(try NFCContentRules.validateTextPayload(Data([0x05, 0x70])))
        XCTAssertThrowsError(try NFCContentRules.validateTextPayload(Data([0x80, 0x00])))
        XCTAssertThrowsError(try NFCContentRules.validateTextPayload(Data([0x00, 0xFF])))
    }

    func testRejectEmptyAmbiguousUnknownAndOversize() throws {
        XCTAssertThrowsError(try NDEFDecoder.decode(NFCNDEFMessage(records: [])))
        XCTAssertThrowsError(try NDEFDecoder.decode(NFCNDEFMessage(records: [textRecord(" ")])))
        XCTAssertThrowsError(try NDEFDecoder.decode(NFCNDEFMessage(records: [textRecord("A"), textRecord("B")])))
        XCTAssertEqual(try NDEFDecoder.decode(NFCNDEFMessage(records: [textRecord("A"), textRecord("A")])), "A")
        XCTAssertThrowsError(try NDEFDecoder.decode(NFCNDEFMessage(records: [textRecord(String(repeating: "x", count: 2049))])))
        let unknown = NFCNDEFPayload(format: .media, type: Data("text/plain".utf8), identifier: Data(), payload: Data("A".utf8))
        XCTAssertThrowsError(try NDEFDecoder.decode(NFCNDEFMessage(records: [unknown])))
    }
}
