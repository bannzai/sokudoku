import CryptoKit
import Foundation

/// 本文を識別するキー。読書位置を本文ごとに端末へ保存するのに使う。本文そのものは保存しない (Web 版の readerStorage.ts と同じ方針)。
public func textKey(_ text: String) -> String {
    SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
}

/// 指定した位置の単位から最後の単位までを読み終えるのにかかる時間 (秒) を返す。位置が範囲外なら 0。
public func remainingDuration(units: [ReadingUnit], from index: Int, speed: ReadingSpeed) -> TimeInterval {
    guard units.indices.contains(index) else {
        return 0
    }
    return units[index...].reduce(0) { $0 + displayDuration(unit: $1, speed: speed) }
}

/// 保存した読書位置を、今の単位の数に収めて返す。区切り方が変わって単位の数が減った時に、範囲外の位置で開かないようにする。
public func resumableIndex(savedIndex: Int?, unitCount: Int) -> Int {
    guard let savedIndex, unitCount > 0 else {
        return 0
    }
    return min(max(savedIndex, 0), unitCount - 1)
}
