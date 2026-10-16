import XCTest
@testable import PackemWMSCore

final class WMSPolicyTests: XCTestCase {
    func testOnlyExactHTTPSOrigins() {
        XCTAssertTrue(WMSPolicy.allows(WMSPolicy.production))
        XCTAssertTrue(WMSPolicy.allows(WMSPolicy.preview.appendingPathComponent("tests/ui/nfc-app.html")))
        for url in ["http://wms-packem.vercel.app/", "https://wms-packem.vercel.app.evil.test/", "https://other.vercel.app/", "https://wms-packem.vercel.app:444/", "https://user:pass@wms-packem.vercel.app/", "file:///tmp/wms.html", "javascript:alert(1)"] {
            XCTAssertFalse(WMSPolicy.allows(URL(string: url)), url)
        }
    }
    func testFrameOriginRequiresTLSAndStandardPort() {
        XCTAssertTrue(WMSPolicy.allowsOrigin(scheme: "https", host: "wms-packem.vercel.app", port: 0))
        XCTAssertTrue(WMSPolicy.allowsOrigin(scheme: "https", host: "wms-packem.vercel.app", port: 443))
        XCTAssertFalse(WMSPolicy.allowsOrigin(scheme: "http", host: "wms-packem.vercel.app", port: 80))
        XCTAssertFalse(WMSPolicy.allowsOrigin(scheme: "https", host: "evil.test", port: 443))
    }
    func testBindingRequiresUUIDAndKnownCountingScreen() {
        let id = UUID().uuidString
        XCTAssertNotNil(WMSBinding(body: ["sessionId": id, "target": "v-floor"]))
        XCTAssertNotNil(WMSBinding(body: ["sessionId": id, "target": "v-labels"]))
        XCTAssertNil(WMSBinding(body: ["sessionId": "fake", "target": "v-floor"]))
        XCTAssertNil(WMSBinding(body: ["sessionId": id, "target": "stock-operation"]))
    }
    func testProgramReceiptRequiresExplicitAcceptance() throws {
        XCTAssertEqual(try ProgramReceipt(response: ["accepted": true, "label": "Tag relida"]).label, "Tag relida")
        let invalid: [[String: Any]] = [["accepted": false, "label": "Tag"], ["accepted": true], ["accepted": true, "label": ""]]
        for value in invalid {
            XCTAssertThrowsError(try ProgramReceipt(response: value))
        }
    }
    func testReceiptRequiresExplicitAcceptanceAndLabel() throws {
        XCTAssertTrue(try CountReceipt(response: ["accepted": true, "duplicate": true, "label": "Já contada"]).duplicate)
        let invalid: [[String: Any]] = [["accepted": false], ["accepted": true], ["accepted": true, "duplicate": false, "label": ""]]
        for value in invalid {
            XCTAssertThrowsError(try CountReceipt(response: value))
        }
    }
    func testUTF8NDEFTextAndLimits() throws {
        let text = "JOB=teste;ID=T001;COD=0303450047;QTD=300;UN=KG"
        XCTAssertEqual(try TagCodec.decodeText(TagCodec.textPayload(text)), text)
        XCTAssertThrowsError(try TagCodec.textPayload(String(repeating: "x", count: 121)))
        XCTAssertThrowsError(try TagCodec.decodeText(Data([0x80, 0x00])))
    }
    func testUIDFromMemoryVerifiesBothCheckBytes() throws {
        let uid: [UInt8] = [0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66]
        var memory = Array(uid.prefix(3)) + [0x88 ^ uid[0] ^ uid[1] ^ uid[2]] + Array(uid.suffix(4))
        memory += [uid[3] ^ uid[4] ^ uid[5] ^ uid[6]] + Array(repeating: UInt8(0), count: 7)
        XCTAssertEqual(try TagCodec.uidFromPageZero(Data(memory)), Data(uid))
        memory[8] ^= 1
        XCTAssertThrowsError(try TagCodec.uidFromPageZero(Data(memory)))
    }
}
