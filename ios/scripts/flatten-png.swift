// シミュレータで撮った PNG を App Store に出せる形にして上書きする。
// App Store Connect は alpha のあるスクリーンショットを受け付けないため alpha を落とし、
// アプリの描画と関係なくシステムが写し込むもの (左上の点・ホームインジケータ) を背景の色で塗る。
// 使い方: swift ios/scripts/flatten-png.swift <png のパス>
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
      let context = CGContext(
          data: nil,
          width: image.width,
          height: image.height,
          bitsPerComponent: 8,
          bytesPerRow: 0,
          space: CGColorSpace(name: CGColorSpace.sRGB)!,
          bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
      )
else {
    FileHandle.standardError.write("ERROR: \(url.path) を読めない\n".data(using: .utf8)!)
    exit(1)
}
context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
// iOS 27 のシミュレータの画面を撮ると、アプリの描画と関係なく左上の隅に 4x4 ピクセルの黒い点が入る
// (2026-10-25 に、起動引数なしの通常の起動画面でも同じ点が出ることを観測)。隣の画素の色で塗りつぶす
if let data = context.data {
    let pixels = data.bindMemory(to: UInt8.self, capacity: context.bytesPerRow * image.height)
    let sourceOffset = 6 * context.bytesPerRow + 6 * 4
    for y in 0 ..< 4 {
        for x in 0 ..< 4 {
            for channel in 0 ..< 4 {
                pixels[y * context.bytesPerRow + x * 4 + channel] = pixels[sourceOffset + channel]
            }
        }
    }
    // iOS が描くホームインジケータが、端末の枠より下の背景に写る (persistentSystemOverlays(.hidden) でも消えないことを 2026-10-25 に観測)。
    // 枠の下端は画面の高さの 98.5% (ios/Sokudoku/AppStoreScreenshots.swift の AppStoreScreenshotDeviceFrame) のため、
    // それより 1 画素下からの行は背景だけになるよう、各行を左端の画素の色で塗る
    for y in Int((Double(image.height) * 0.985).rounded(.up)) + 1 ..< image.height {
        for x in 1 ..< image.width {
            for channel in 0 ..< 4 {
                pixels[y * context.bytesPerRow + x * 4 + channel] = pixels[y * context.bytesPerRow + channel]
            }
        }
    }
}
guard let flattened = context.makeImage(),
      let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
else {
    FileHandle.standardError.write("ERROR: \(url.path) に書けない\n".data(using: .utf8)!)
    exit(1)
}
CGImageDestinationAddImage(destination, flattened, nil)
guard CGImageDestinationFinalize(destination) else {
    FileHandle.standardError.write("ERROR: \(url.path) の書き出しに失敗\n".data(using: .utf8)!)
    exit(1)
}
