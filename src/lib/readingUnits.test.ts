import { describe, expect, it } from "vitest";
import { segmentText } from "./readingUnits";

// 青空文庫の夏目漱石「吾輩は猫である」の冒頭 (著作権の保護期間が満了した作品)。段落の先頭の全角空白も原文のまま
const aozoraExcerpt =
  "　吾輩は猫である。名前はまだ無い。\n　どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。";

/** 各単位の text が、元の文字列の start から end までと一致することを確かめる。 */
function expectOffsetsMatchSource(source: string) {
  for (const unit of segmentText(source).units) {
    expect(source.slice(unit.start, unit.end)).toBe(unit.text);
  }
}

describe("segmentText", () => {
  it("日本語を BudouX の文節に分け、文と段落の終わりに間をとる", () => {
    const { sentences, units } = segmentText(aozoraExcerpt);
    expect(units.map((unit) => unit.text)).toEqual([
      "吾輩は",
      "猫である。",
      "名前は",
      "まだ",
      "無い。",
      "どこで",
      "生れたかとんと",
      "見当が",
      "つかぬ。",
      "何でも",
      "薄暗いじめじめした",
      "所で",
      "ニャーニャー泣いていた",
      "事だけは",
      "記憶している。",
    ]);
    expect(units.map((unit) => unit.sentenceIndex)).toEqual([0, 0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3]);
    expect(units.map((unit) => unit.pause)).toEqual([
      "none",
      "sentence",
      "none",
      "none",
      "paragraph",
      "none",
      "none",
      "none",
      "sentence",
      "none",
      "none",
      "none",
      "none",
      "none",
      "paragraph",
    ]);
    expect(units.every((unit) => unit.language === "ja")).toBe(true);
    expect(sentences).toEqual([
      { start: 1, end: 9, language: "ja" },
      { start: 9, end: 17, language: "ja" },
      { start: 19, end: 36, language: "ja" },
      { start: 36, end: 72, language: "ja" },
    ]);
    expect(aozoraExcerpt.slice(sentences[1].start, sentences[1].end)).toBe("名前はまだ無い。");
    expectOffsetsMatchSource(aozoraExcerpt);
  });

  it("日本語の読点に間をとり、閉じ括弧を文末に含める", () => {
    const { sentences, units } = segmentText("「ええ、そうです」と彼は言った。");
    expect(units.map((unit) => [unit.text, unit.pause])).toEqual([
      ["「ええ、", "comma"],
      ["そうです」と", "none"],
      ["彼は", "none"],
      ["言った。", "paragraph"],
    ]);
    expect(sentences).toHaveLength(1);
  });

  it("英語を空白で単語に分け、句読点を前の単語に付ける", () => {
    const source = "It was the best of times, it was the worst of times. Mr. Smith said so!\n\nThe end.";
    const { sentences, units } = segmentText(source);
    expect(units.map((unit) => unit.text)).toEqual([
      "It",
      "was",
      "the",
      "best",
      "of",
      "times,",
      "it",
      "was",
      "the",
      "worst",
      "of",
      "times.",
      "Mr.",
      "Smith",
      "said",
      "so!",
      "The",
      "end.",
    ]);
    expect(units.filter((unit) => unit.pause !== "none").map((unit) => [unit.text, unit.pause])).toEqual([
      ["times,", "comma"],
      ["times.", "sentence"],
      ["so!", "paragraph"],
      ["end.", "paragraph"],
    ]);
    expect(units.every((unit) => unit.language === "en")).toBe(true);
    expect(sentences.map((sentence) => source.slice(sentence.start, sentence.end))).toEqual([
      "It was the best of times, it was the worst of times.",
      "Mr. Smith said so!",
      "The end.",
    ]);
    expectOffsetsMatchSource(source);
  });

  it("引用符・括弧で始まる略語を文末にしない", () => {
    const source = "“Dr. Smith is here.” (Mr. Brown left.)";
    const { sentences } = segmentText(source);
    expect(sentences.map((sentence) => source.slice(sentence.start, sentence.end))).toEqual([
      "“Dr. Smith is here.”",
      "(Mr. Brown left.)",
    ]);
  });

  it("日本語と英語が混在する文章は段落ごとに言語を判定し、日本語の段落の中の英単語は空白で分ける", () => {
    const source = "Next.jsの静的書き出しを GitHub Pages で配信する。\nThis is a pen.";
    const { sentences, units } = segmentText(source);
    expect(units.map((unit) => [unit.text, unit.language, unit.sentenceIndex])).toEqual([
      ["Next.jsの", "ja", 0],
      ["静的", "ja", 0],
      ["書き出しを", "ja", 0],
      ["GitHub", "en", 0],
      ["Pages", "en", 0],
      ["で", "ja", 0],
      ["配信する。", "ja", 0],
      ["This", "en", 1],
      ["is", "en", 1],
      ["a", "en", 1],
      ["pen.", "en", 1],
    ]);
    expect(sentences.map((sentence) => sentence.language)).toEqual(["ja", "en"]);
    expectOffsetsMatchSource(source);
  });

  it("U+2028・U+2029 を段落の区切りにし、その前の本文を落とさない", () => {
    const source = "前半\u2028後半。\u2029最後";
    expect(segmentText(source).units.map((unit) => [unit.text, unit.pause])).toEqual([
      ["前半", "paragraph"],
      ["後半。", "paragraph"],
      ["最後", "paragraph"],
    ]);
    expectOffsetsMatchSource(source);
  });

  it("サロゲートペアの漢字を壊さずに位置を返す", () => {
    const source = "𠮟られた。";
    expect(segmentText(source).units.map((unit) => unit.text)).toEqual(["𠮟られた。"]);
    expectOffsetsMatchSource(source);
  });

  it("空文字と改行・空白だけの入力は単位も文も返さない", () => {
    for (const source of ["", "\n\n\r\n", "　 \n\t"]) {
      expect(segmentText(source)).toEqual({ sentences: [], units: [] });
    }
  });
});
