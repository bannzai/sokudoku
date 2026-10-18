import Foundation

/// ユーザーが設定する読む速度。
public struct ReadingSpeed: Equatable, Sendable, Codable {
    /// 日本語の 1 分あたりの文字数。
    public var japaneseCharactersPerMinute: Int
    /// 英語の 1 分あたりの単語数。
    public var englishWordsPerMinute: Int

    public init(japaneseCharactersPerMinute: Int, englishWordsPerMinute: Int) {
        self.japaneseCharactersPerMinute = japaneseCharactersPerMinute
        self.englishWordsPerMinute = englishWordsPerMinute
    }

    /// Web 版の既定値 (src/lib/readerState.ts の defaultReadingSpeed) と揃える。日本語 600 文字/分・英語 300 語/分の根拠は同ファイルのコメント。
    public static let `default` = ReadingSpeed(japaneseCharactersPerMinute: 600, englishWordsPerMinute: 300)

    /// 速度の範囲と上げ下げの幅。Web 版の speedLimits (src/lib/readerState.ts) と揃える。
    public static let japaneseRange = 100...3000
    public static let japaneseStep = 50
    public static let englishRange = 50...1500
    public static let englishStep = 25

    /// 指定した言語の速度を、幅の倍数だけ上げ下げした速度を返す (負の数で下げる)。範囲外は上限・下限に収める。
    public func stepped(language: Language, by stepDelta: Int) -> ReadingSpeed {
        var speed = self
        switch language {
        case .ja:
            speed.japaneseCharactersPerMinute = clamp(japaneseCharactersPerMinute + Self.japaneseStep * stepDelta, Self.japaneseRange)
        case .en:
            speed.englishWordsPerMinute = clamp(englishWordsPerMinute + Self.englishStep * stepDelta, Self.englishRange)
        }
        return speed
    }
}

/// 間の長さを 1 単位 (日本語は平均的な文節、英語は 1 単語) を表示する時間の何倍にするか。
/// Web 版 (src/lib/displayDuration.ts) と同じ値。読点 < 文末 < 段落の終わり の順に長くした初期値で、実測に基づく値ではない。
private func pauseLengthInUnits(_ pause: Pause) -> Double {
    switch pause {
    case .none: 0
    case .comma: 0.5
    case .sentence: 1
    case .paragraph: 2
    }
}

/// 日本語の間の基準にする平均的な文節の文字数。Web 版 (src/lib/displayDuration.ts) と同じく、青空文庫「吾輩は猫である」の冒頭の文節の平均 (約 4.6 文字) に近い整数。
private let japaneseCharactersPerAverageUnit = 5.0

/// 日本語の単位の文字数を返す。空白を除き、句読点・括弧は含めて数える (Unicode のコードポイント単位)。
public func japaneseCharacterCount(_ text: String) -> Int {
    text.unicodeScalars.filter { !$0.properties.isWhitespace }.count
}

/// 単位を表示する時間 (秒) を返す。
///
/// 日本語の単位は空白以外の文字数を 1 分あたりの文字数で割り、英語の単位は 1 単語ぶんの時間にする。
/// 単位の後の間 (読点・文末・段落の終わり) の時間を足す。固有名詞などの単位の中身では時間を変えない (documents/adr/0002-avoid-patented-features-and-drm-import.md)。
public func displayDuration(unit: ReadingUnit, speed: ReadingSpeed) -> TimeInterval {
    switch unit.language {
    case .ja:
        let secondsPerCharacter = 60.0 / Double(max(speed.japaneseCharactersPerMinute, 1))
        return secondsPerCharacter * (Double(japaneseCharacterCount(unit.text)) + pauseLengthInUnits(unit.pause) * japaneseCharactersPerAverageUnit)
    case .en:
        return 60.0 / Double(max(speed.englishWordsPerMinute, 1)) * (1 + pauseLengthInUnits(unit.pause))
    }
}

private func clamp(_ value: Int, _ range: ClosedRange<Int>) -> Int {
    min(max(value, range.lowerBound), range.upperBound)
}
