import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AboutPage from "./about/page";
import HomePage from "./page";
import ReadPage from "./read/page";

// next/link は vitest では next.config.ts の basePath (/sokudoku) と trailingSlash を当てず、末尾の / を落とした href を出すため、
// href は basePath を除き、末尾の / の有無を問わずに比べる
describe("ページの URL の構成", () => {
  it("/ はリーダーの取り込み画面を開き、LP (/about/) への導線を出す", () => {
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain("読む本文を選ぶ");
    expect(html).toMatch(/<a [^>]*href="\/about\/?"[^>]*>このサービスについて<\/a>/);
  });

  it("/about/ は LP を開き、「リーダーを開く」は / を指す", () => {
    const html = renderToStaticMarkup(<AboutPage />);
    expect(html).toContain("RSVP 速読リーダー");
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>リーダーを開く<\/a>/);
  });

  it("/read/ は basePath を含む / へ meta refresh で移す", () => {
    expect(renderToStaticMarkup(<ReadPage />)).toMatch(/<meta http-equiv="refresh" content="0; url=\.\.\/"\/?>/);
  });
});
