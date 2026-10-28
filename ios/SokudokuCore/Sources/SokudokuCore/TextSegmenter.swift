// Dictionary は Mecab-Swift の product ではないが、IPADic と Mecab-Swift の依存として一緒にビルドされ、DictionaryProviding と PartOfSpeech を公開している
import Dictionary
import Foundation
import IPADic
import Mecab_Swift

/// 文字列を RSVP で読む単位に分ける。日本語は MeCab (IPADic) の品詞から文節を組み立て、英語は空白で単語に分ける。
///
/// Web 版の segmentText (src/lib/readingUnits.ts) と同じく、改行で区切った行を段落、段落の文字で言語を判定し、
/// 間は句読点・文末・段落の終わりだけから決める (documents/adr/0002-avoid-patented-features-and-drm-import.md)。
/// MeCab の辞書を開いて保持するため、画面ごとに 1 つ作って使い回す。
public final class TextSegmenter {
    private let partOfSpeechTokenizer: Tokenizer
    private let baseFormTokenizer: Tokenizer

    /// IPADic の辞書を開く。辞書を開けない時は MeCab の Tokenizer のエラーを投げる。
    public init() throws {
        let dictionaryURL = IPADic().url
        partOfSpeechTokenizer = try Tokenizer(dictionary: IPADicFeatureColumns(url: dictionaryURL, firstColumn: 0, secondColumn: 1))
        baseFormTokenizer = try Tokenizer(dictionary: IPADicFeatureColumns(url: dictionaryURL, firstColumn: 6, secondColumn: 6))
    }

    /// 文字列を読む単位に分割し、各単位の元の文字列での位置・属する文・後にとる間を返す。
    public func segment(_ source: String) -> SegmentedText {
        let nsSource = source as NSString
        var sentences: [Sentence] = []
        var units: [ReadingUnit] = []
        for paragraphMatch in paragraphPattern.matches(in: source, range: NSRange(location: 0, length: nsSource.length)) {
            let paragraphRange = paragraphMatch.range
            let paragraph = nsSource.substring(with: paragraphRange)
            let paragraphLanguage: Language = containsJapanese(paragraph) ? .ja : .en
            let paragraphUnitCount = units.count
            for sentenceRange in sentenceRanges(paragraph: paragraph, language: paragraphLanguage) {
                let sentence = (paragraph as NSString).substring(with: sentenceRange)
                let offset = paragraphRange.location + sentenceRange.location
                var sentenceUnits = wordRanges(sentence: sentence, language: paragraphLanguage).map { range -> ReadingUnit in
                    let text = (sentence as NSString).substring(with: range)
                    return ReadingUnit(
                        text: text,
                        start: offset + range.location,
                        end: offset + range.location + range.length,
                        language: containsJapanese(text) ? .ja : .en,
                        sentenceIndex: sentences.count,
                        pause: matches(commaPattern, text) ? .comma : .none
                    )
                }
                guard !sentenceUnits.isEmpty else {
                    continue
                }
                sentenceUnits[sentenceUnits.count - 1].pause = .sentence
                sentences.append(Sentence(start: sentenceUnits[0].start, end: sentenceUnits[sentenceUnits.count - 1].end, language: paragraphLanguage))
                units.append(contentsOf: sentenceUnits)
            }
            if units.count > paragraphUnitCount {
                units[units.count - 1].pause = .paragraph
            }
        }
        return SegmentedText(sentences: sentences, units: units)
    }

    /// 段落の中の各文の範囲 (段落内の UTF-16 の範囲) を返す。英語の文末は単語の末尾の記号で決める。
    private func sentenceRanges(paragraph: String, language: Language) -> [NSRange] {
        let nsParagraph = paragraph as NSString
        if language == .ja {
            return japaneseSentencePattern.matches(in: paragraph, range: NSRange(location: 0, length: nsParagraph.length))
                .map(\.range)
                .filter { $0.length > 0 }
        }
        var ranges: [NSRange] = []
        var sentenceStart = 0
        for word in wordPattern.matches(in: paragraph, range: NSRange(location: 0, length: nsParagraph.length)) {
            let wordText = nsParagraph.substring(with: word.range)
            let abbreviationCandidate = wordText.replacingOccurrences(of: #"^["'“‘(\[]+"#, with: "", options: .regularExpression).lowercased()
            if matches(englishSentenceEndPattern, wordText), !englishAbbreviations.contains(abbreviationCandidate) {
                let end = word.range.location + word.range.length
                ranges.append(NSRange(location: sentenceStart, length: end - sentenceStart))
                sentenceStart = end
            }
        }
        if nsParagraph.substring(from: sentenceStart).contains(where: { !$0.isWhitespace }) {
            ranges.append(NSRange(location: sentenceStart, length: nsParagraph.length - sentenceStart))
        }
        return ranges
    }

    /// 文の中の各単位の範囲 (文内の UTF-16 の範囲) を返す。空白だけの部分は単位にしない。
    /// 日本語は文節の先頭の位置で区切り、文節の中の空白でさらに分ける (日本語の文の中の英単語を 1 語ずつにするため)。
    private func wordRanges(sentence: String, language: Language) -> [NSRange] {
        let nsSentence = sentence as NSString
        let chunkBoundaries = language == .ja
            ? [0] + bunsetsuStarts(sentence: sentence).filter { $0 > 0 } + [nsSentence.length]
            : [0, nsSentence.length]
        return zip(chunkBoundaries, chunkBoundaries.dropFirst()).flatMap { chunkStart, chunkEnd -> [NSRange] in
            wordPattern.matches(in: sentence, range: NSRange(location: chunkStart, length: chunkEnd - chunkStart)).map(\.range)
        }
    }

    /// 文の中で文節が始まる位置 (文内の UTF-16 のオフセット) を返す。
    private func bunsetsuStarts(sentence: String) -> [Int] {
        let partOfSpeechAnnotations = partOfSpeechTokenizer.tokenize(text: sentence, transliteration: .katakana)
        let baseFormAnnotations = baseFormTokenizer.tokenize(text: sentence, transliteration: .katakana)
        let morphemes = zip(partOfSpeechAnnotations, baseFormAnnotations).map { partOfSpeechAnnotation, baseFormAnnotation in
            Morpheme(
                surface: partOfSpeechAnnotation.base,
                partOfSpeech: partOfSpeechAnnotation.reading,
                partOfSpeechDetail: partOfSpeechAnnotation.dictionaryForm,
                baseForm: baseFormAnnotation.reading,
                start: sentence.utf16.distance(from: sentence.utf16.startIndex, to: partOfSpeechAnnotation.range.lowerBound)
            )
        }
        let starts = zip([nil] + morphemes.map(Optional.some), morphemes)
            .filter { previous, current in startsBunsetsu(current: current, previous: previous) }
            .map { $0.1.start }
        return joinBrackets(sentence: sentence, starts: starts)
    }
}

/// 括弧を閉じる前に文節が切れた時 (「「ニンニクの / 芽」」)、閉じ括弧を含む文節までを 1 つにした文節の先頭の位置を返す。
/// 結合後が maxBracketJoinedLength を超える括弧 (「（大蒜、学名: Allium sativum）は、」) は割れたままにする。
func joinBrackets(sentence: String, starts: [Int]) -> [Int] {
    let nsSentence = sentence as NSString
    let ends = Array(starts.dropFirst()) + [nsSentence.length]
    var joinedStarts: [Int] = []
    var index = 0
    while index < starts.count {
        joinedStarts.append(starts[index])
        let opened = nsSentence.substring(with: NSRange(location: starts[index], length: ends[index] - starts[index]))
        guard unclosedBracketCount(opened) > 0 else {
            index += 1
            continue
        }
        var closingIndex = index + 1
        while closingIndex < starts.count {
            let candidate = nsSentence.substring(with: NSRange(location: starts[index], length: ends[closingIndex] - starts[index]))
            if japaneseCharacterCount(candidate) > maxBracketJoinedLength {
                closingIndex = starts.count
                break
            }
            if unclosedBracketCount(candidate) == 0 {
                break
            }
            closingIndex += 1
        }
        index = closingIndex < starts.count ? closingIndex + 1 : index + 1
    }
    return joinedStarts
}

/// 括弧を閉じるまでの結合で 1 回に読む量の上限 (文字数)。Web 版の maxBracketJoinedLength (src/lib/readingUnits.ts) と同じく、
/// ニンニクの段落の括弧 (「ニンニクの芽」は結合後 8 文字) は収め、15 文字を超える括弧は割れたままにする。
let maxBracketJoinedLength = 15

private let openingBrackets: Set<Character> = ["（", "(", "「", "『", "【", "〔", "［", "[", "“", "‘"]
private let closingBrackets: Set<Character> = ["）", ")", "」", "』", "】", "〕", "］", "]", "”", "’"]

/// 文字列の中で、対応する閉じ括弧が後ろに無い開き括弧の数を返す。括弧の種類は区別しない。
func unclosedBracketCount(_ text: String) -> Int {
    text.reduce(0) { count, character in
        if openingBrackets.contains(character) {
            return count + 1
        }
        if closingBrackets.contains(character), count > 0 {
            return count - 1
        }
        return count
    }
}

/// MeCab が返す 1 つの形態素のうち、文節の組み立てに使う IPADic の素性。
struct Morpheme {
    /// 本文の中の表記。
    let surface: String
    /// 品詞 (IPADic の素性の 1 列目。名詞・動詞・助詞・記号 等)。
    let partOfSpeech: String
    /// 品詞細分類 1 (IPADic の素性の 2 列目。自立・非自立・接尾・括弧開 等)。
    let partOfSpeechDetail: String
    /// 原形 (IPADic の素性の 7 列目)。
    let baseForm: String
    /// 文の中での開始位置 (UTF-16 のオフセット)。
    let start: Int
}

/// 形態素が新しい文節の先頭になるかを返す。文節は 1 つの自立語と、その後に続く付属語 (助詞・助動詞・接尾辞・非自立語・記号) からなる。
///
/// - 助詞・助動詞、開き括弧以外の記号、非自立・接尾の語は前の文節に付ける
/// - 名詞の連続 (複合語「スタミナ増進作用」) は 1 つの文節にする
/// - サ変動詞「する」(「併用し」「として」) は前の語に付ける
/// - 接頭詞・開き括弧の次の語は、それらと同じ文節にする
func startsBunsetsu(current: Morpheme, previous: Morpheme?) -> Bool {
    guard let previous else {
        return true
    }
    if previous.partOfSpeech == "接頭詞" || (previous.partOfSpeech == "記号" && previous.partOfSpeechDetail == "括弧開") {
        return false
    }
    switch current.partOfSpeech {
    case "助詞", "助動詞":
        return false
    case "記号":
        return current.partOfSpeechDetail == "括弧開"
    default:
        break
    }
    if current.partOfSpeechDetail == "非自立" || current.partOfSpeechDetail == "接尾" {
        return false
    }
    if current.partOfSpeech == "動詞" && current.baseForm == "する" {
        return false
    }
    if current.partOfSpeech == "名詞" && previous.partOfSpeech == "名詞" {
        return false
    }
    return true
}

/// IPADic の辞書を、MeCab の素性のうち任意の 2 列を読み出せる形で渡す。
///
/// Mecab-Swift の公開 API (Annotation) は品詞を 8 種類に丸めた PartOfSpeech と、読み (readingIndex の列) と原形 (dictionaryFormIndex の列) だけを返す。
/// 文節の組み立てには品詞細分類 (非自立・接尾・括弧開) が要るため、読みと原形の列の位置に読み出したい素性の列を指定し、
/// 変換しない katakana の Transliteration で取り出す。
struct IPADicFeatureColumns: DictionaryProviding {
    let url: URL
    /// Annotation.reading で読み出す素性の列 (0 始まり)。
    let firstColumn: Int
    /// Annotation.dictionaryForm で読み出す素性の列 (0 始まり)。
    let secondColumn: Int

    var readingIndex: Int { firstColumn }
    var pronunciationIndex: Int { firstColumn }
    var dictionaryFormIndex: Int { secondColumn }

    func partOfSpeech(posID: UInt16) -> PartOfSpeech {
        IPADic().partOfSpeech(posID: posID)
    }
}

/// 改行 (CR・LF・VT・FF・NEL・U+2028・U+2029) を含まない連続を 1 つの段落にする。
/// 正規表現の `.` はこれらの改行に一致しないため、どれかが段落に残ると文の照合が失敗して前の本文が単位から消える
private let paragraphPattern = try! NSRegularExpression(pattern: #"[^\r\n\x{000B}\x{000C}\x{0085}\x{2028}\x{2029}]+"#)

/// 仮名・漢字。長音符「ー」や句読点「。、」も Script_Extensions では仮名・漢字に含まれる。
private let japaneseCharacterPattern = try! NSRegularExpression(
    pattern: #"[\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Han}]"#
)

/// 文末記号の後に閉じ括弧・閉じ引用符が続く場合は、それらまでを 1 文に含める。
private let japaneseSentencePattern = try! NSRegularExpression(pattern: #".+?(?:[。．！？!?]+[」』）)】〕］"”’]*|$)"#)

private let englishSentenceEndPattern = try! NSRegularExpression(pattern: #"[.!?]+["'”’)\]]*$"#)

/// ピリオドで終わっても文末ではない英語の略語。文末に置かれることが多い etc. は含めない。
private let englishAbbreviations: Set<String> = ["mr.", "mrs.", "ms.", "dr.", "prof.", "st.", "vs.", "e.g.", "i.e."]

private let commaPattern = try! NSRegularExpression(pattern: #"[、，,;；:：]["'”’)\]」』）】〕］]*$"#)

private let wordPattern = try! NSRegularExpression(pattern: #"\S+"#)

/// 文字列が日本語の文字 (仮名・漢字) を含むかを返す。
func containsJapanese(_ text: String) -> Bool {
    matches(japaneseCharacterPattern, text)
}

private func matches(_ pattern: NSRegularExpression, _ text: String) -> Bool {
    pattern.firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length)) != nil
}
