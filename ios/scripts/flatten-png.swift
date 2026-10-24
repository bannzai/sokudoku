// PNG から alpha を落として上書きする。App Store Connect は alpha のあるスクリーンショットを受け付けないため。
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
