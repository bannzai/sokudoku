import XCTest
@testable import SokudokuCore

// 青空文庫のファイルの末尾にある、作成元を示す文。Web 版のテスト (src/lib/aozoraBunko.test.ts) と同じ入力で同じ結果になることを確かめる
private let aozoraBunkoCreditLine = "このファイルは、インターネットの図書館、青空文庫（https://www.aozora.gr.jp/）で作られました。"

final class AozoraBunkoTests: XCTestCase {
    func testRubyWithAndWithoutStartMarkIsRemoved() {
        XCTAssertEqual(stripAozoraBunkoNotation("吾輩《わがはい》は一番｜獰悪《どうあく》な猫"), "吾輩は一番獰悪な猫")
    }

    func testInputterNotesAreRemovedAndGaijiMarkIsKept() {
        XCTAssertEqual(
            stripAozoraBunkoNotation("［＃８字下げ］一［＃「一」は中見出し］\n※［＃「言＋墟のつくり」、第4水準2-88-74］の字"),
            "一\n※の字"
        )
    }

    func testNestedNotesAreRemovedToTheOuterEnd() {
        XCTAssertEqual(
            stripAozoraBunkoNotation("※［＃「言＋墟のつくり」、第4水準2-88-74］の字［＃「※［＃「言＋墟のつくり」、第4水準2-88-74］の字」に傍点］です"),
            "※の字です"
        )
    }

    func testMultipleSourceBooksAreAllRemoved() {
        XCTAssertEqual(
            stripAozoraBunkoNotation("本文\n\n底本：「上巻」出版社\n　　　1990年発行\n底本：「下巻」出版社\n入力：（入力者名）\n\(aozoraBunkoCreditLine)"),
            "本文"
        )
    }

    func testSourceBookLineWithoutCreditIsKept() {
        let text = "書評\n底本：「引用した本」出版社\nこの本の感想の続き"
        XCTAssertEqual(stripAozoraBunkoNotation(text), text)
    }

    func testTitleAndAuthorAreKeptAndHeaderAndFooterAreRemoved() {
        let text = [
            "題名",
            "著者",
            "",
            "-------------------------------------------------------",
            "【テキスト中に現れる記号について】",
            "《》：ルビ",
            "-------------------------------------------------------",
            "",
            "本文",
            "",
            "底本：「底本」出版社",
            "入力：（入力者名）",
            aozoraBunkoCreditLine,
        ].joined(separator: "\n")
        XCTAssertEqual(stripAozoraBunkoNotation(text), "題名\n著者\n\n本文")
    }

    func testSeparatorLinesWithoutSymbolDescriptionAreKept() {
        XCTAssertEqual(stripAozoraBunkoNotation("前\n----------\n中\n----------\n後"), "前\n----------\n中\n----------\n後")
    }

    func testReadableTextNormalizesLineBreaksAndStripsOnlyAozoraBunkoText() {
        XCTAssertEqual(readableText(importedText: "吾輩《わがはい》は猫である。［＃改ページ］\r\n名前はまだ無い。"), "吾輩は猫である。\n名前はまだ無い。")
        // 青空文庫の書式でない文章の《》は本文として残す
        XCTAssertEqual(readableText(importedText: "書名《副題》\r\n本文"), "書名《副題》\n本文")
    }

    func testAozoraBunkoTextIsDetected() {
        XCTAssertTrue(isAozoraBunkoText("【テキスト中に現れる記号について】"))
        XCTAssertTrue(isAozoraBunkoText("［＃改ページ］"))
        XCTAssertTrue(isAozoraBunkoText("本文\n底本：「底本」\n\(aozoraBunkoCreditLine)"))
        XCTAssertFalse(isAozoraBunkoText("吾輩は猫である。名前はまだ無い。"))
        XCTAssertFalse(isAozoraBunkoText("書評\n底本：「引用した本」出版社"))
    }
}
