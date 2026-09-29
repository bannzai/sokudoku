import { describe, expect, it } from "vitest";
import { displayDurationMs } from "./displayDuration";
import { segmentText } from "./readingUnits";

const speed = { japaneseCharactersPerMinute: 600, englishWordsPerMinute: 300 };

describe("displayDurationMs", () => {
  it("日本語は文字数と 1 分あたりの文字数から計算し、文末と段落の終わりで間を足す", () => {
    expect(
      segmentText("　吾輩は猫である。名前はまだ無い。").units.map((unit) => [unit.text, displayDurationMs(unit, speed)]),
    ).toEqual([
      ["吾輩は", 300],
      ["猫である。", 1000],
      ["名前は", 300],
      ["まだ", 200],
      ["無い。", 1300],
    ]);
  });

  it("日本語の読点で間を足す", () => {
    expect(displayDurationMs({ text: "「ええ、", language: "ja", pause: "comma" }, speed)).toBe(650);
  });

  it("英語は 1 分あたりの単語数から 1 単語の時間を計算し、句読点・文末・段落の終わりで間を足す", () => {
    expect(
      segmentText("Yes, it was. The end.").units.map((unit) => [unit.text, displayDurationMs(unit, speed)]),
    ).toEqual([
      ["Yes,", 300],
      ["it", 200],
      ["was.", 400],
      ["The", 200],
      ["end.", 600],
    ]);
  });

  it("混在する文章は単位の文字種で速度を選ぶ", () => {
    expect(
      segmentText("GitHub Pages で配信する。").units.map((unit) => [unit.text, displayDurationMs(unit, speed)]),
    ).toEqual([
      ["GitHub", 200],
      ["Pages", 200],
      ["で", 100],
      ["配信する。", 1500],
    ]);
  });

  it("固有名詞かどうかでは時間を変えない", () => {
    expect(displayDurationMs({ text: "Smith", language: "en", pause: "none" }, speed)).toBe(
      displayDurationMs({ text: "table", language: "en", pause: "none" }, speed),
    );
    expect(displayDurationMs({ text: "漱石は", language: "ja", pause: "none" }, speed)).toBe(
      displayDurationMs({ text: "これは", language: "ja", pause: "none" }, speed),
    );
  });

  it("速度が 0 以下なら例外を投げる", () => {
    expect(() =>
      displayDurationMs(
        { text: "a", language: "en", pause: "none" },
        { japaneseCharactersPerMinute: 600, englishWordsPerMinute: 0 },
      ),
    ).toThrow(RangeError);
  });
});
