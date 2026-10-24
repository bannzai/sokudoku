import XCTest
@testable import SokudokuCore

/// Fixtures の EPUB (中身は scripts/make-epub-fixtures.sh) を読む。
private func fixture(name: String) throws -> Data {
    let url = try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: "epub", subdirectory: "Fixtures"))
    return try Data(contentsOf: url)
}

final class EpubTests: XCTestCase {
    func testChaptersAreExtractedInSpineOrder() throws {
        let book = try epubBook(data: fixture(name: "sample"))
        XCTAssertEqual(book.title, "テスト用の本")
        // 表紙 (画像だけ)・目次 (nav)・linear="no" の注は章にしない。manifest ではなく spine の順に並べる
        XCTAssertEqual(book.chapters, [
            EpubChapter(
                title: "第一章　猫",
                // 見出しと段落は空行で区切る。段落の中のソースの改行は、日本語の文字の間なら詰める。style・script・画像は本文にしない。
                // pre の中の改行は詰めずに残す
                text: "第一章　猫\n\n吾輩は猫である。名前はまだ無い。\n\nどこで生れたか\u{00A0}とんと見当がつかぬ。\n\n一行目の詩\n二行目の詩"
            ),
            EpubChapter(
                // 見出しの無い章は本文の先頭の行を題名にする。英文の単語の間のソースの改行は、曲線引用符の前でも空白 1 つにし、br は改行にする。
                // CDATA の中も本文にし (中の &amp; は文字参照ではなくそのままの文字)、&eacute; のような XHTML の DTD の文字参照も読む
                title: "This is an English line.",
                // 表のセルの間も区切る
                text: "This is an English line.\n\n一行目\n二行目\n\nCDATA の中の文 &amp;\n\nCafé and the “answer”\n\nred\n\nblue"
            ),
            // UTF-16 で保存した文書も、XHTML の DTD の文字参照を含めて読む
            EpubChapter(title: "第三章", text: "第三章\n\nUTF-16 で書いた本文\u{00A0}café"),
        ])
    }

    func testRubyReadingIsRemovedAndBaseTextIsKept() throws {
        let text = try XCTUnwrap(epubBook(data: fixture(name: "sample")).chapters.first).text
        XCTAssertTrue(text.contains("吾輩は猫である。"))
        XCTAssertFalse(text.contains("わがはい"))
        XCTAssertFalse(text.contains("（"))
    }

    func testEpubWithEncryptedChapterIsRejectedAsDrmProtected() throws {
        XCTAssertThrowsError(try epubBook(data: fixture(name: "drm"))) { error in
            XCTAssertEqual(error as? EpubError, .drmProtected)
        }
    }

    func testEpubWithOnlyObfuscatedFontIsAccepted() throws {
        XCTAssertEqual(try epubBook(data: fixture(name: "font-obfuscated")), try epubBook(data: fixture(name: "sample")))
    }

    func testDataThatIsNotZipIsUnreadable() {
        XCTAssertThrowsError(try epubBook(data: Data("吾輩は猫である。".utf8))) { error in
            guard case .unreadable = error as? EpubError else {
                return XCTFail("unreadable ではなく \(error) を投げた")
            }
        }
    }

    func testBrokenPackageDocumentIsUnreadable() throws {
        // 壊れる前に読めた章だけで取り込まない
        XCTAssertThrowsError(try epubBook(data: fixture(name: "broken-package"))) { error in
            guard case .unreadable(let reason) = error as? EpubError else {
                return XCTFail("unreadable ではなく \(error) を投げた")
            }
            XCTAssertTrue(reason.hasPrefix("OEBPS/content.opf を解析できません"), reason)
        }
    }

    func testSpineItemMissingFromManifestIsUnreadable() throws {
        // 章が欠けたまま読み進めないよう、残りの章が読めても取り込まない
        XCTAssertThrowsError(try epubBook(data: fixture(name: "missing-chapter"))) { error in
            XCTAssertEqual(error as? EpubError, .unreadable("spine の missing の文書がありません"))
        }
    }

    func testEpubOverExtractionLimitIsUnreadable() throws {
        XCTAssertThrowsError(try epubBook(data: fixture(name: "too-large"))) { error in
            XCTAssertEqual(error as? EpubError, .unreadable("本文が大きすぎます"))
        }
    }
}
