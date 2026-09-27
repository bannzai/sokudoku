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

/** mimetype を無圧縮で先頭に置いた、最小の EPUB の zip を作る */
function buildEpub(files: Record<string, string>): Uint8Array {
  return zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    ...Object.fromEntries(Object.entries(files).map(([path, content]) => [path, strToU8(content)])),
  });
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
