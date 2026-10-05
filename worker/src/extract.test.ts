import { describe, expect, it } from "vitest";
import { articleHtml, articleParagraphs } from "./__fixtures__/articlePage";
import { wikipediaHtml, wikipediaInfoboxCells, wikipediaParagraphs } from "./__fixtures__/wikipediaPage";
import { extractArticle } from "./extract";

describe("extractArticle", () => {
  it("記事の本文を、HTML を除いて段落ごとに空行で区切った文字列にする", () => {
    const article = extractArticle(articleHtml);
    expect(article).toBeDefined();
    expect(article?.text.split("\n\n")).toEqual(["速読の方法", articleParagraphs[0], "RSVP", ...articleParagraphs.slice(1)]);
  });

  it("ナビゲーション・フッター・スクリプト・ルビの読みを本文に含めない", () => {
    const text = extractArticle(articleHtml)?.text ?? "";
    expect(text).not.toContain("トップ");
    expect(text).not.toContain("Copyright");
    expect(text).not.toContain("tracking");
    expect(text).not.toContain("ぶんせつ");
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it("タイトル・サイト名・言語を返す", () => {
    expect(extractArticle(articleHtml)).toMatchObject({
      title: "速読の方法 - サンプルの百科事典",
      siteName: "サンプルの百科事典",
      lang: "ja",
    });
  });

  it("本文の無いページは undefined を返す", () => {
    expect(extractArticle("<!doctype html><html><head><title>空</title></head><body></body></html>")).toBeUndefined();
  });

  it("日本語の文の途中の改行は空白にせず、英字の間の改行は空白 1 つにする", () => {
    const html = articleHtml
      .replace("文章を通常よりも", "文章を\n    通常よりも")
      .replace("</article>", "<p>speed\nreading は速く\n読む技術である。英語の speed reading と同じ意味で使われることが多い。</p></article>");
    const paragraphs = extractArticle(html)?.text.split("\n\n") ?? [];
    expect(paragraphs).toContain(articleParagraphs[0]);
    expect(paragraphs.at(-1)).toBe("speed reading は速く読む技術である。英語の speed reading と同じ意味で使われることが多い。");
  });

  it("pre の中の改行は行ごとの段落にする", () => {
    const html = articleHtml.replace("</article>", "<pre>const a = 1;\n\nconst b = 2;</pre></article>");
    expect(extractArticle(html)?.text.split("\n\n").slice(-2)).toEqual(["const a = 1;", "const b = 2;"]);
  });

  it("Wikipedia の記事は、infobox・「出典: フリー百科事典…」の行より前に出さず本文の最初の段落から始める", () => {
    expect(extractArticle(wikipediaHtml)?.text.split("\n\n")).toEqual([
      wikipediaParagraphs[0],
      wikipediaParagraphs[1],
      "栽培",
      wikipediaParagraphs[2],
      "利用",
      wikipediaParagraphs[3],
    ]);
  });

  it("Wikipedia の出典番号・infobox の表のセル・見出しの [編集] リンクを本文に含めない", () => {
    const text = extractArticle(wikipediaHtml)?.text ?? "";
    expect(text).not.toMatch(/\[(注\s*)?\d+\]/);
    for (const cell of wikipediaInfoboxCells) {
      expect(text).not.toContain(cell);
    }
    expect(text).not.toContain("出典: フリー百科事典");
    expect(text).not.toContain("[編集]");
  });

  it("角括弧だけでない上付き文字 (指数等) は本文に残す", () => {
    const html = articleHtml.replace("</article>", "<p>この部屋の広さは 20m<sup>2</sup> ほどで、本を読むには十分な広さがある。</p></article>");
    expect(extractArticle(html)?.text.split("\n\n").at(-1)).toBe("この部屋の広さは 20m2 ほどで、本を読むには十分な広さがある。");
  });
});
