import { Readability } from "@mozilla/readability";
// linkedom の既定の入口は canvas の読み込みを含むため、Workers 向けにまとめられた入口を使う
import { parseHTML } from "linkedom/worker";

/** /extract が返す本文。text は段落ごとに空行で区切った、HTML を含まない文字列 */
export type ExtractedArticle = { title: string; text: string; siteName?: string; lang?: string };

// 段落の区切りにする要素。ここに無い要素 (a・em・span 等) は前後の文字と同じ段落に含める
const blockTagNames = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "SECTION",
  "SUMMARY",
  "UL",
]);

// 読む文字を持たない要素と、表。Readability が除いた後に残っていても本文に入れない。
// 表 (Wikipedia の infobox・navbox 等) はセルの文字が文脈なしに並ぶだけで、RSVP で 1 単位ずつ読む対象にならない。
// Readability は見出しのセル (th) を持つ表をデータの表とみなして本文に残すため、ここで落とす
const skippedTagNames = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "MATH", "RT", "RP", "TABLE"]);

/** 文字が角括弧で囲まれた部分だけの上付き文字。Wikipedia の出典番号 ([4]・[注 1]) や [要出典] のような注記のマーカー */
const bracketOnlySupPattern = /^\[[^[\]]+\]$/;

// MediaWiki (Wikipedia 等) の「出典: フリー百科事典『ウィキペディア（Wikipedia）』」の行と、見出しの [編集] リンク。
// どちらも本文と同じ普通の文字の要素で、要素の種類や文字の形の汎用の規則では本文と見分けられないため、MediaWiki が付ける id・class で落とす。
// Readability は出力から class を除くため、Readability に渡す前の DOM から落とす
const mediaWikiChromeSelector = "#siteSub, .mw-editsection";

/** 日本語の文字 (漢字・ひらがな・カタカナ・全角の記号) に挟まれた、改行を含む空白の並び。前の文字を $1 に取る */
const cjkLineBreakPattern =
  /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯])[^\S\n]*\n\s*(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯])/gu;

/**
 * ページの HTML から Readability で本文を取り出し、段落ごとの文字列にする。
 * 本文を取り出せない (Readability が記事と判定しない・文字が空) 時は undefined を返す
 */
export function extractArticle(html: string): ExtractedArticle | undefined {
  const { document } = parseHTML(html);
  for (const element of Array.from(document.querySelectorAll(mediaWikiChromeSelector))) {
    element.remove();
  }
  // linkedom の Document は DOM の Document の型と一致しないが、Readability が使う API は備えている
  const article = new Readability(document as unknown as Document).parse();
  if (!article?.content) {
    return undefined;
  }
  const text = htmlToParagraphs(article.content).join("\n\n");
  if (text === "") {
    return undefined;
  }
  return {
    title: article.title?.trim() ?? "",
    text,
    ...(article.siteName ? { siteName: article.siteName } : {}),
    ...(article.lang ? { lang: article.lang } : {}),
  };
}

/** Readability が返した本文の HTML を、段落ごとの文字列 (連続する空白は 1 つにし、空の段落は除く) の配列にする */
function htmlToParagraphs(contentHtml: string): string[] {
  const { document } = parseHTML(`<!doctype html><html><body>${contentHtml}</body></html>`);
  const paragraphs: string[] = [];
  let currentParagraph = "";

  function flushParagraph() {
    const paragraph = currentParagraph
      // ソースの HTML で日本語の文を行の途中で折り返した改行は、ブラウザの表示と同じく空白にしない
      .replace(cjkLineBreakPattern, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (paragraph !== "") {
      paragraphs.push(paragraph);
    }
    currentParagraph = "";
  }

  function visit(node: Node) {
    if (node.nodeType === 3) {
      currentParagraph += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== 1) {
      return;
    }
    const tagName = (node as Element).tagName.toUpperCase();
    if (skippedTagNames.has(tagName)) {
      return;
    }
    if (tagName === "SUP" && bracketOnlySupPattern.test((node.textContent ?? "").trim())) {
      return;
    }
    if (tagName === "BR") {
      flushParagraph();
      return;
    }
    if (tagName === "PRE") {
      // 整形済みの文字は改行に意味があるため、行ごとに段落にする
      flushParagraph();
      for (const line of (node.textContent ?? "").split("\n")) {
        currentParagraph = line;
        flushParagraph();
      }
      return;
    }
    const isBlock = blockTagNames.has(tagName);
    if (isBlock) {
      flushParagraph();
    }
    for (const child of Array.from(node.childNodes)) {
      visit(child);
    }
    if (isBlock) {
      flushParagraph();
    }
  }

  visit(document.body as unknown as Node);
  flushParagraph();
  return paragraphs;
}
