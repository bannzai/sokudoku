import XCTest
@testable import SokudokuCore

// 青空文庫の夏目漱石「吾輩は猫である」の冒頭 (著作権の保護期間が満了した作品)。段落の先頭の全角空白も原文のまま。Web 版のテスト (src/lib/readingUnits.test.ts) と同じ文
private let aozoraExcerpt =
    "　吾輩は猫である。名前はまだ無い。\n　どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。"

// Wikipedia 日本語版「ニンニク」の冒頭の 2 段落 (CC BY-SA 4.0、2026-10-05 に取得)。出典番号 ([4] 等) は除いた。Web 版のテストと同じ文
private let wikipediaGarlicExcerpt =
    "ニンニク（大蒜、学名: Allium sativum）は、ヒガンバナ科ネギ属の多年草。香りが強く、強壮・スタミナ増進作用があると信じられているため、球根（鱗茎）を香辛料などとして食用にするほか、茎も「ニンニクの芽」（トウ）と呼ばれて野菜として調理される。強烈な風味を持つことから、肉食の習慣がある地域で肉類と併用し、臭みを消す食材、香辛料として普及している。強精効果の為、修行にならなくなるとして禅門では敬遠された過去がある。五葷・五辛の1つ。\n鱗茎（球根）の部分は世界各国で用いられる香辛料で、強い香りと風味を持つことから、肉食の習慣がある地域で普及している。古くから、疲労回復、強壮作用があることが知られており、古代エジプトや古代ギリシアでは、薬として使われていたといわれる。"

final class TextSegmenterTests: XCTestCase {
    private var segmenter: TextSegmenter!

    override func setUpWithError() throws {
        segmenter = try TextSegmenter()
    }

    /// 各単位の text が、元の文字列の start から end までと一致することを確かめる。
    private func assertOffsetsMatchSource(_ source: String, file: StaticString = #filePath, line: UInt = #line) {
        let nsSource = source as NSString
        for unit in segmenter.segment(source).units {
            XCTAssertEqual(nsSource.substring(with: NSRange(location: unit.start, length: unit.end - unit.start)), unit.text, file: file, line: line)
        }
    }

    func testJapaneseIsSplitIntoBunsetsuWithSentenceAndParagraphPauses() {
        let segmented = segmenter.segment(aozoraExcerpt)
        print("aozora:", segmented.units.map(\.text).joined(separator: " / "))
        XCTAssertEqual(segmented.units.map(\.text), [
            "吾輩は", "猫である。",
            "名前は", "まだ", "無い。",
            "どこで", "生れたか", "とんと", "見当が", "つかぬ。",
            // IPADic は「所」を非自立の名詞と判定するため前の語に付く。「いた事」は IPADic に 1 語の名詞として載っているため「泣いて」と分かれる
            "何でも", "薄暗い", "じめじめした所で", "ニャーニャー", "泣いて", "いた事だけは", "記憶している。",
        ])
        XCTAssertEqual(segmented.units.map(\.pause), [
            .none, .sentence,
            .none, .none, .paragraph,
            .none, .none, .none, .none, .sentence,
            .none, .none, .none, .none, .none, .none, .paragraph,
        ])
        XCTAssertEqual(segmented.sentences.map { $0.start }, [1, 9, 19, 36])
        XCTAssertTrue(segmented.units.allSatisfy { $0.language == .ja })
        assertOffsetsMatchSource(aozoraExcerpt)
    }

    func testAttachedWordsAndBracketsStayInTheBunsetsu() {
        let units = segmenter.segment(wikipediaGarlicExcerpt).units.map(\.text)
        print("garlic:", units.joined(separator: " / "))
        for expected in ["香辛料などとして", "「ニンニクの芽」", "信じられているため、", "習慣が", "併用し、", "ヒガンバナ科ネギ属の", "1つ。", "使われていたと"] {
            XCTAssertTrue(units.contains(expected), "\(expected) が 1 単位になっていない")
        }
        // 助詞・助動詞だけの単位を作らない
        XCTAssertFalse(units.contains { ["して", "ため", "ため、", "する", "と", "は、"].contains($0) })
        assertOffsetsMatchSource(wikipediaGarlicExcerpt)
    }

    func testEnglishIsSplitIntoWordsAndAbbreviationsDoNotEndSentences() {
        let source = "Mr. Smith reads fast. He likes it!\nNew paragraph"
        let segmented = segmenter.segment(source)
        XCTAssertEqual(segmented.units.map(\.text), ["Mr.", "Smith", "reads", "fast.", "He", "likes", "it!", "New", "paragraph"])
        XCTAssertEqual(segmented.units.map(\.pause), [.none, .none, .none, .sentence, .none, .none, .paragraph, .none, .paragraph])
        XCTAssertTrue(segmented.units.allSatisfy { $0.language == .en })
        XCTAssertEqual(segmented.sentences.count, 3)
        assertOffsetsMatchSource(source)
    }

    func testEnglishWordsInsideJapaneseAreSeparateUnits() {
        let units = segmenter.segment("GitHub Pages で公開する。").units
        XCTAssertEqual(units.map(\.text).first, "GitHub")
        XCTAssertEqual(units.first?.language, .en)
        assertOffsetsMatchSource("GitHub Pages で公開する。")
    }

    func testEmptyAndWhitespaceOnlyTextHasNoUnits() {
        XCTAssertEqual(segmenter.segment("").units, [])
        XCTAssertEqual(segmenter.segment(" \n　\n").units, [])
    }

    func testSurrogatePairsAreNotBroken() {
        let source = "𠮷野家で食べた。"
        XCTAssertEqual(segmenter.segment(source).units.map(\.text).joined(), source)
        assertOffsetsMatchSource(source)
    }
}

final class DisplayDurationTests: XCTestCase {
    private func unit(_ text: String, _ language: Language, _ pause: Pause) -> ReadingUnit {
        ReadingUnit(text: text, start: 0, end: (text as NSString).length, language: language, sentenceIndex: 0, pause: pause)
    }

    func testJapaneseDurationIsProportionalToCharactersPlusPause() {
        // 600 文字/分 = 1 文字 0.1 秒。「吾輩は」3 文字、文末の間は平均的な文節 5 文字ぶん
        XCTAssertEqual(displayDuration(unit: unit("吾輩は", .ja, .none), speed: .default), 0.3, accuracy: 0.0001)
        XCTAssertEqual(displayDuration(unit: unit("猫である。", .ja, .sentence), speed: .default), 1.0, accuracy: 0.0001)
    }

    func testEnglishDurationIsOneWordPlusPause() {
        // 300 語/分 = 1 語 0.2 秒。読点の間は 0.5 語ぶん
        XCTAssertEqual(displayDuration(unit: unit("fast,", .en, .comma), speed: .default), 0.3, accuracy: 0.0001)
    }

    func testSpeedStepsAreClampedToTheRange() {
        XCTAssertEqual(ReadingSpeed.default.stepped(language: .ja, by: 1).japaneseCharactersPerMinute, 650)
        XCTAssertEqual(ReadingSpeed.default.stepped(language: .en, by: -100).englishWordsPerMinute, 50)
        XCTAssertEqual(ReadingSpeed.default.stepped(language: .ja, by: 1000).japaneseCharactersPerMinute, 3000)
    }
}
