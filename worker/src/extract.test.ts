import { describe, expect, it } from "vitest";
import { articleHtml, articleParagraphs } from "./__fixtures__/articlePage";
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

  it("pre の中の改行は行ごとの段落にする", () => {
    const html = articleHtml.replace("</article>", "<pre>const a = 1;\n\nconst b = 2;</pre></article>");
    expect(extractArticle(html)?.text.split("\n\n").slice(-2)).toEqual(["const a = 1;", "const b = 2;"]);
  });
});
