import CryptoKit
import Foundation

/// 本文を識別するキー。読書位置を本文ごとに端末へ保存するのに使う。本文そのものは保存しない (Web 版の readerStorage.ts と同じ方針)。
public func textKey(_ text: String) -> String {
    SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
}

/// 各位置の単位から最後の単位までを読み終えるのにかかる時間 (秒) を、位置ごとに返す。要素数は単位の数 + 1 で、末尾は 0。
/// 再生中は位置が変わるたびに残り時間を出すため、分割の完了時と速度の変更時に一度だけ計算し、位置の更新では添字で引く。
public func remainingDurations(units: [ReadingUnit], speed: ReadingSpeed) -> [TimeInterval] {
    Array(units.reversed().reduce(into: [0.0]) { suffixSums, unit in
        suffixSums.append(suffixSums[suffixSums.count - 1] + displayDuration(unit: unit, speed: speed))
    }.reversed())
}

/// 保存した読書位置を、今の単位の数に収めて返す。区切り方が変わって単位の数が減った時に、範囲外の位置で開かないようにする。
public func resumableIndex(savedIndex: Int?, unitCount: Int) -> Int {
    guard let savedIndex, unitCount > 0 else {
        return 0
    }
    return min(max(savedIndex, 0), unitCount - 1)
}
