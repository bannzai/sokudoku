import { readFile } from "node:fs/promises";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { decodeTextBytes, importFile, importPlainText } from "./importText";

/** __fixtures__ のテスト用ファイルをバイト列で読む */
async function readFixture(fileName: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL(`./__fixtures__/${fileName}`, import.meta.url)));
}

const nekoText = "吾輩は猫である。名前はまだ無い。\nどこで生れたかとんと見当がつかぬ。";

describe("decodeTextBytes", () => {
  it("UTF-8 としても Shift_JIS としても不正なバイト列は undefined を返す", () => {
    expect(decodeTextBytes(new Uint8Array([0xff]))).toBeUndefined();
  });
});

describe("importFile", () => {
  it("UTF-8 の txt を読む", async () => {
    expect(importFile("neko.txt", await readFixture("utf8.txt"))).toEqual({ ok: true, text: nekoText });
  });

  it("Shift_JIS の txt を読む", async () => {
    expect(importFile("neko.txt", await readFixture("shift_jis.txt"))).toEqual({ ok: true, text: nekoText });
  });

  it("青空文庫の Shift_JIS・CRLF の txt から、記号の説明・注記・ルビ・底本情報を除く", async () => {
    expect(importFile("wagahaiwa_nekodearu.TXT", await readFixture("aozora_shift_jis.txt"))).toEqual({
      ok: true,
      text: [
        "吾輩は猫である",
        "夏目漱石",
        "",
        "一",
        "",
        "　吾輩は猫である。名前はまだ無い。",
        "　しかもあとで聞くとそれは書生という人間中で一番獰悪な種族であったそうだ。",
        "　※の字は外字",
      ].join("\n"),
    });
  });

  it("空の txt は空であることを返す", () => {
    expect(importFile("empty.txt", new Uint8Array())).toEqual({ ok: false, reason: "empty" });
  });

  it("文字コードを判定できない txt はその理由を返す", () => {
    expect(importFile("broken.txt", new Uint8Array([0xff]))).toEqual({ ok: false, reason: "unsupported-encoding" });
  });

  it("本文の無い EPUB は空であることを返す", () => {
    const epub = zipSync({
      mimetype: [strToU8("application/epub+zip"), { level: 0 }],
      "META-INF/container.xml": strToU8(
        `<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`,
      ),
      "content.opf": strToU8(`<package><manifest/><spine/></package>`),
    });
    expect(importFile("empty.epub", epub)).toEqual({ ok: false, reason: "empty" });
  });

  it("txt と EPUB 以外のファイルは読み込まない", () => {
    expect(importFile("book.pdf", strToU8("%PDF"))).toEqual({ ok: false, reason: "unsupported-file" });
    expect(importFile("README", strToU8("本文"))).toEqual({ ok: false, reason: "unsupported-file" });
  });
});

describe("importPlainText", () => {
  it("改行を LF に揃え、前後の空白を除く", () => {
    expect(importPlainText("\r\n一行目\r\n二行目\r三行目\n\n")).toEqual({ ok: true, text: "一行目\n二行目\n三行目" });
  });

  it("「底本：」で始まる行を含む貼り付けでも、青空文庫の作成の文が無ければ本文を削らない", () => {
    expect(importPlainText("書評の本文\n底本：「引用した本」出版社\n感想の続き")).toEqual({
      ok: true,
      text: "書評の本文\n底本：「引用した本」出版社\n感想の続き",
    });
  });

  it("空白だけの貼り付けは空であることを返す", () => {
    expect(importPlainText(" \n　\t")).toEqual({ ok: false, reason: "empty" });
  });
});
