import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { extractEpubText } from "./epub";

const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

// manifest の並びと spine の並びを変え、spine の順に読むことを確かめる
const packageDocumentXml = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">test</dc:identifier>
    <dc:title>テスト</dc:title>
    <dc:language>ja</dc:language>
  </metadata>
  <manifest>
    <item id="chapter2" href="text/chapter%202.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="text/notes.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="../style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
    <itemref idref="notes" linear="no"/>
    <itemref idref="chapter2"/>
  </spine>
</package>`;

/** 本文の body を持つ XHTML の文書を作る */
function xhtmlDocument(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>見出しに出さない題名</title><style>p { color: red; }</style></head>
<body>${body}</body>
</html>`;
}

/** mimetype を無圧縮で先頭に置いた、最小の EPUB の zip を作る。文字列の中身は UTF-8 で入れる */
function buildEpub(files: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    ...Object.fromEntries(
      Object.entries(files).map(([path, content]) => [path, typeof content === "string" ? strToU8(content) : content]),
    ),
  });
}

/**
 * zip の central directory にある、指定したファイルの展開後の大きさの宣言値を書き換えた複製を返す。
 * 中身は小さいまま、展開後の大きさを偽った zip (zip bomb) を作る。
 * 書式は ZIP の仕様 (APPNOTE.TXT 4.3.12) の central directory file header で、宣言値は先頭から 24 バイト目・名前の長さは 28 バイト目
 */
function declareOriginalSize(zip: Uint8Array, path: string, originalSize: number): Uint8Array {
  const declaredZip = zip.slice();
  new DataView(declaredZip.buffer).setUint32(findCentralDirectoryEntryOffset(declaredZip, path) + 24, originalSize, true);
  return declaredZip;
}

/** zip の central directory で、指定したファイルの名前を同じ長さの別の名前に書き換えた複製を返す。同じパスのエントリが複数ある zip を作る */
function renameCentralDirectoryEntry(zip: Uint8Array, path: string, newPath: string): Uint8Array {
  const renamedZip = zip.slice();
  renamedZip.set(strToU8(newPath), findCentralDirectoryEntryOffset(renamedZip, path) + 46);
  return renamedZip;
}

/** zip の central directory で、指定したファイルの file header の先頭の位置を返す */
function findCentralDirectoryEntryOffset(zip: Uint8Array, path: string): number {
  const view = new DataView(zip.buffer);
  const pathBytes = strToU8(path);
  for (let offset = 0; offset + 46 <= zip.length; offset += 1) {
    if (
      view.getUint32(offset, true) === 0x02014b50 &&
      view.getUint16(offset + 28, true) === pathBytes.length &&
      pathBytes.every((byte, index) => zip[offset + 46 + index] === byte)
    ) {
      return offset;
    }
  }
  throw new Error(`central directory に ${path} が無い`);
}

/** BOM を先頭に付けた UTF-16LE のバイト列を作る */
function encodeUtf16le(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfeff, true);
  for (let index = 0; index < text.length; index += 1) {
    view.setUint16(2 + index * 2, text.charCodeAt(index), true);
  }
  return bytes;
}

const minimalEpubFiles = {
  "META-INF/container.xml": containerXml,
  "OEBPS/content.opf": packageDocumentXml,
  "OEBPS/text/chapter1.xhtml": xhtmlDocument(`
    <h1>第一章</h1>
    <p><ruby>吾輩<rp>(</rp><rt>わがはい</rt><rp>)</rp></ruby>は猫である。<br/>名前は&nbsp;まだ無い。</p>
    <p>どこで生れたか
      とんと見当がつかぬ。</p>`),
  "OEBPS/text/notes.xhtml": xhtmlDocument("<p>補足の注</p>"),
  "OEBPS/text/chapter 2.xhtml": xhtmlDocument("<div><p>第二章の本文</p></div>"),
};

describe("extractEpubText", () => {
  it("spine の順に本文を取り出し、ルビの読み・head・linear=no の文書を除く", () => {
    expect(extractEpubText(buildEpub(minimalEpubFiles))).toEqual({
      ok: true,
      text: ["第一章", "吾輩は猫である。", "名前は まだ無い。", "どこで生れたか とんと見当がつかぬ。", "第二章の本文"].join("\n"),
    });
  });

  it("ブロック要素の前にあるテキストと、入れ子のブロックのテキストを連結しない", () => {
    expect(
      extractEpubText(
        buildEpub({ ...minimalEpubFiles, "OEBPS/text/chapter1.xhtml": xhtmlDocument("<div>First<p>Second</p>Third</div>") }),
      ),
    ).toEqual({ ok: true, text: "First\nSecond\nThird\n第二章の本文" });
  });

  it("pre の中の改行を行の区切りとして残す", () => {
    expect(
      extractEpubText(
        buildEpub({ ...minimalEpubFiles, "OEBPS/text/chapter1.xhtml": xhtmlDocument("<pre>第一行\n第二行</pre>") }),
      ),
    ).toEqual({ ok: true, text: "第一行\n第二行\n第二章の本文" });
  });

  it("CDATA で書いた本文を取り込む", () => {
    expect(
      extractEpubText(
        buildEpub({ ...minimalEpubFiles, "OEBPS/text/chapter1.xhtml": xhtmlDocument("<p><![CDATA[CDATA の本文]]></p>") }),
      ),
    ).toEqual({ ok: true, text: "CDATA の本文\n第二章の本文" });
  });

  it("BOM の付いた UTF-16 の OPF と XHTML を読む", () => {
    expect(
      extractEpubText(
        buildEpub({
          ...minimalEpubFiles,
          "OEBPS/content.opf": encodeUtf16le(packageDocumentXml),
          "OEBPS/text/chapter1.xhtml": encodeUtf16le(xhtmlDocument("<p>UTF-16 の本文</p>")),
        }),
      ),
    ).toEqual({ ok: true, text: "UTF-16 の本文\n第二章の本文" });
  });

  it("spine が参照する章のファイルが無い EPUB は EPUB として読めないことを返す", () => {
    expect(
      extractEpubText(
        buildEpub(Object.fromEntries(Object.entries(minimalEpubFiles).filter(([path]) => path !== "OEBPS/text/chapter 2.xhtml"))),
      ),
    ).toEqual({ ok: false, reason: "invalid-epub" });
  });

  it("spine の idref が manifest に無い EPUB は EPUB として読めないことを返す", () => {
    expect(
      extractEpubText(
        buildEpub({
          ...minimalEpubFiles,
          "OEBPS/content.opf": packageDocumentXml.replace(`<itemref idref="chapter2"/>`, `<itemref idref="missing"/>`),
        }),
      ),
    ).toEqual({ ok: false, reason: "invalid-epub" });
  });

  it("encryption.xml のある EPUB は本文を返さず、DRM を理由に返す", () => {
    expect(
      extractEpubText(
        buildEpub({
          ...minimalEpubFiles,
          "META-INF/encryption.xml": `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"/>`,
        }),
      ),
    ).toEqual({ ok: false, reason: "drm" });
  });

  it("Adobe の権利情報 rights.xml のある EPUB は本文を返さず、DRM を理由に返す", () => {
    expect(extractEpubText(buildEpub({ ...minimalEpubFiles, "META-INF/rights.xml": "<rights/>" }))).toEqual({
      ok: false,
      reason: "drm",
    });
  });

  it("大文字小文字が仕様と違う DRM の目印のファイルがある EPUB も、DRM を理由に返す", () => {
    expect(extractEpubText(buildEpub({ ...minimalEpubFiles, "META-INF/Encryption.xml": "<encryption/>" }))).toEqual({
      ok: false,
      reason: "drm",
    });
  });

  it("本文の XHTML の展開後の大きさが上限を超えると宣言された EPUB は、展開せずに大きすぎることを返す", () => {
    expect(
      extractEpubText(declareOriginalSize(buildEpub(minimalEpubFiles), "OEBPS/text/chapter1.xhtml", 0x7fffffff)),
    ).toEqual({ ok: false, reason: "too-large" });
  });

  it("同じパスのエントリが複数ある EPUB は、すべてのエントリの展開後の大きさを足して上限を判定する", () => {
    // 大きさを偽ったエントリの後に同じパスの小さいエントリを置き、後者の大きさだけで上限を判定させようとする zip
    expect(
      extractEpubText(
        renameCentralDirectoryEntry(
          declareOriginalSize(
            buildEpub({ ...minimalEpubFiles, "OEBPS/text/chapterX.xhtml": xhtmlDocument("<p>小さい章</p>") }),
            "OEBPS/text/chapter1.xhtml",
            0x7fffffff,
          ),
          "OEBPS/text/chapterX.xhtml",
          "OEBPS/text/chapter1.xhtml",
        ),
      ),
    ).toEqual({ ok: false, reason: "too-large" });
  });

  it("本文に使わない META-INF のファイルは、展開後の大きさが上限を超えると宣言されていても展開せずに本文を読む", () => {
    expect(
      extractEpubText(
        declareOriginalSize(
          buildEpub({ ...minimalEpubFiles, "META-INF/calibre_bookmarks.txt": "しおり" }),
          "META-INF/calibre_bookmarks.txt",
          0x7fffffff,
        ),
      ),
    ).toEqual(extractEpubText(buildEpub(minimalEpubFiles)));
  });

  it("zip として読めないバイト列は EPUB として読めないことを返す", () => {
    expect(extractEpubText(strToU8("EPUB ではないテキスト"))).toEqual({ ok: false, reason: "invalid-epub" });
  });

  it("container.xml の無い zip は EPUB として読めないことを返す", () => {
    expect(extractEpubText(buildEpub({ "OEBPS/content.opf": packageDocumentXml }))).toEqual({
      ok: false,
      reason: "invalid-epub",
    });
  });
});
