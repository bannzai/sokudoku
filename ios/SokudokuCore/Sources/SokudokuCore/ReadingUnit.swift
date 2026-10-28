import Foundation

/// 文章・単位の言語。日本語は文節、英語は単語を 1 単位にする。
public enum Language: String, Sendable, Codable {
    case ja
    case en
}

/// 単位を表示した後にとる間の種類。句読点・文末・段落の終わりだけから決める (documents/adr/0002-avoid-patented-features-and-drm-import.md)。
public enum Pause: String, Sendable, Codable {
    case none
    case comma
    case sentence
    case paragraph
}

/// RSVP で 1 回に表示する単位 (日本語は文節、英語は単語)。
public struct ReadingUnit: Equatable, Sendable {
    /// 表示する文字列。元の文字列の start から end までの部分と一致する。
    public let text: String
    /// 元の文字列での開始位置 (UTF-16 のオフセット、この位置を含む)。
    public let start: Int
    /// 元の文字列での終了位置 (UTF-16 のオフセット、この位置を含まない)。
    public let end: Int
    /// 単位の文字種から決めた言語。表示時間の計算で、文字数と単語数のどちらの速度を使うかを決める。
    public let language: Language
    /// 属する文の番号。全文の先頭の文を 0 とし、SegmentedText の sentences の添字と一致する。
    public let sentenceIndex: Int
    /// この単位を表示した後にとる間の種類。
    public var pause: Pause
}

/// 全文の中の 1 文。
public struct Sentence: Equatable, Sendable {
    /// 元の文字列での開始位置 (UTF-16 のオフセット、この位置を含む)。
    public let start: Int
    /// 元の文字列での終了位置 (UTF-16 のオフセット、この位置を含まない)。
    public let end: Int
    /// 文が属する段落から判定した言語。
    public let language: Language
}

/// TextSegmenter.segment の結果。units を先頭から順に表示すると全文を読める。
public struct SegmentedText: Equatable, Sendable {
    /// 全文の文を、先頭から順に並べたもの。
    public let sentences: [Sentence]
    /// 表示する単位を、先頭から順に並べたもの。
    public let units: [ReadingUnit]
}
