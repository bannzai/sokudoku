import { describe, expect, it } from "vitest";
import { segmentText } from "./readingUnits";

// 青空文庫の夏目漱石「吾輩は猫である」の冒頭 (著作権の保護期間が満了した作品)。段落の先頭の全角空白も原文のまま
const aozoraExcerpt =
  "　吾輩は猫である。名前はまだ無い。\n　どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。";

// Wikipedia 日本語版「ニンニク」の冒頭の 2 段落 (CC BY-SA 4.0、2026-10-05 に取得)。出典番号 ([4] 等) は除いた
const wikipediaGarlicExcerpt =
  "ニンニク（大蒜、学名: Allium sativum）は、ヒガンバナ科ネギ属の多年草。香りが強く、強壮・スタミナ増進作用があると信じられているため、球根（鱗茎）を香辛料などとして食用にするほか、茎も「ニンニクの芽」（トウ）と呼ばれて野菜として調理される。強烈な風味を持つことから、肉食の習慣がある地域で肉類と併用し、臭みを消す食材、香辛料として普及している。強精効果の為、修行にならなくなるとして禅門では敬遠された過去がある。五葷・五辛の1つ。\n鱗茎（球根）の部分は世界各国で用いられる香辛料で、強い香りと風味を持つことから、肉食の習慣がある地域で普及している。古くから、疲労回復、強壮作用があることが知られており、古代エジプトや古代ギリシアでは、薬として使われていたといわれる。";

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
      "名前はまだ",
      "無い。",
      "どこで",
      "生れたかとんと",
      "見当がつかぬ。",
      "何でも",
      "薄暗いじめじめした",
      "所で",
      "ニャーニャー泣いていた",
      "事だけは",
      "記憶している。",
    ]);
    expect(units.map((unit) => unit.sentenceIndex)).toEqual([0, 0, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 3]);
    expect(units.map((unit) => unit.pause)).toEqual([
      "none",
      "sentence",
      "none",
      "paragraph",
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

  it("BudouX が独立させた付属的な語を前の単位に結合し、割れた括弧を閉じ括弧まで結合する", () => {
    const texts = segmentText(wikipediaGarlicExcerpt).units.map((unit) => unit.text);
    // 「食用にする」の後の「ほか、」、「信じられているため」の後の読点も同じ単位に入る
    for (const phrase of ["香辛料などとして", "「ニンニクの芽」", "信じられているため", "食用にする", "習慣がある"]) {
      expect(texts.some((text) => text.includes(phrase))).toBe(true);
    }
    // 結合すると長くなりすぎる (15 文字) ため、分けたままにする
    expect(texts).toContain("強壮・スタミナ増進作用が");
    expect(texts).toContain("あると");
    const lengths = texts.map((text) => [...text].length);
    expect(lengths.filter((length) => length <= 2).length).toBeLessThanOrEqual(5);
    expect(lengths.filter((length) => length > 15)).toEqual([]);
    expectOffsetsMatchSource(wikipediaGarlicExcerpt);
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
