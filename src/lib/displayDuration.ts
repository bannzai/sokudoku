import type { Pause, ReadingUnit } from "./readingUnits";

/** ユーザーが設定する読む速度。 */
export type ReadingSpeed = {
  /** 日本語の 1 分あたりの文字数。 */
  japaneseCharactersPerMinute: number;
  /** 英語の 1 分あたりの単語数。 */
  englishWordsPerMinute: number;
};

// 間の長さを 1 単位 (日本語は平均的な文節、英語は 1 単語) を表示する時間の何倍にするか。
// 実測に基づく値ではなく、読点 < 文末 < 段落の終わり の順に長くした初期値。
// 単位の表示時間の倍数にすることで、速度を変えても間の比率が変わらない。リーダー画面で使いながら調整する
const pauseLengthInUnits: Record<Pause, number> = {
  none: 0,
  comma: 0.5,
  sentence: 1,
  paragraph: 2,
};

// 日本語の間の基準にする平均的な文節の文字数。
// readingUnits.test.ts の青空文庫の抜粋 (夏目漱石「吾輩は猫である」の冒頭) を BudouX で分けた文節の平均 (約 4.6 文字) に近い整数
const japaneseCharactersPerAverageUnit = 5;

/** 日本語の単位の文字数を返す。空白を除き、句読点・括弧は含めて数える。表示時間と読了した文字数の両方がこの数え方を使う。 */
export function japaneseCharacterCount(text: string): number {
  return [...text.replace(/\s/gu, "")].length;
}

/**
 * 単位を表示する時間 (ミリ秒) を返す。
 *
 * 日本語の単位は空白以外の文字数 (句読点・括弧を含む) を 1 分あたりの文字数で割り、英語の単位は 1 単語ぶんの時間にする。
 * 単位の後の間 (読点・文末・段落の終わり) の時間を足す。固有名詞などの単位の中身では時間を変えない (ADR 0002)。
 */
export function displayDurationMs(unit: Pick<ReadingUnit, "text" | "language" | "pause">, speed: ReadingSpeed): number {
  if (!(speed.japaneseCharactersPerMinute > 0) || !(speed.englishWordsPerMinute > 0)) {
    throw new RangeError("読む速度は 0 より大きい値にする");
  }
  if (unit.language === "ja") {
    const millisecondsPerCharacter = 60_000 / speed.japaneseCharactersPerMinute;
    return Math.round(
      millisecondsPerCharacter *
        (japaneseCharacterCount(unit.text) +
          pauseLengthInUnits[unit.pause] * japaneseCharactersPerAverageUnit),
    );
  }
  return Math.round((60_000 / speed.englishWordsPerMinute) * (1 + pauseLengthInUnits[unit.pause]));
}
