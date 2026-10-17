// swift-tools-version: 5.9
import PackageDescription
let package = Package(
    name: "PackemWMSCore",
    products: [.library(name: "PackemWMSCore", targets: ["PackemWMSCore"])],
    targets: [
        .target(name: "PackemWMSCore", path: "PackemWMS", exclude: ["NFCReader.swift", "WMSWebView.swift", "PackemWMSApp.swift", "Info.plist", "PackemWMS.entitlements"], sources: ["WMSPolicy.swift", "TagCodec.swift"]),
        .testTarget(name: "PackemWMSCoreTests", dependencies: ["PackemWMSCore"], path: "Tests")
    ]
)
