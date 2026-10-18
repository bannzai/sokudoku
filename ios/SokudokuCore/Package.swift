// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "SokudokuCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "SokudokuCore", targets: ["SokudokuCore"]),
    ],
    dependencies: [
        // 端末内の形態素解析 (MeCab) と IPADic の辞書。品詞から文節を組み立てるために使う (documents/adr/0006-ios-native-app-with-on-device-mecab.md)
        .package(url: "https://github.com/shinjukunian/Mecab-Swift", from: "0.8.0"),
    ],
    targets: [
        .target(
            name: "SokudokuCore",
            dependencies: [
                .product(name: "Mecab-Swift", package: "Mecab-Swift"),
                .product(name: "IPADic", package: "Mecab-Swift"),
            ]
        ),
        .testTarget(name: "SokudokuCoreTests", dependencies: ["SokudokuCore"]),
    ]
)
