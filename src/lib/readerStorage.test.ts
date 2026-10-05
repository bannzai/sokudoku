import { describe, expect, it } from "vitest";
import {
  addEnglishReadingDay,
  addFinishedReading,
  addTranslationDisplay,
  type FinishedReading,
  hashText,
  localDateKey,
  paragraphBoundariesForOpening,
  parseEnglishReadingDays,
  parseFinishedReadings,
  parseReadingPositions,
  parseReadingSpeed,
  parseSavedParagraphBoundaries,
  type ReadingPosition,
  resumablePosition,
  summarizeEnglishReadingDays,
  summarizeFinishedReadings,
  upsertParagraphBoundaries,
  upsertReadingPosition,
} from "./readerStorage";

describe("parseReadingSpeed", () => {
  it("範囲内の速度を読む", () => {
    expect(parseReadingSpeed('{"japaneseCharactersPerMinute":800,"englishWordsPerMinute":250}')).toEqual({
      japaneseCharactersPerMinute: 800,
      englishWordsPerMinute: 250,
    });
  });

  it("保存が無い・壊れている・範囲外なら undefined を返す", () => {
    expect(parseReadingSpeed(null)).toBeUndefined();
    expect(parseReadingSpeed("{")).toBeUndefined();
    expect(parseReadingSpeed('{"japaneseCharactersPerMinute":0,"englishWordsPerMinute":250}')).toBeUndefined();
    expect(parseReadingSpeed('{"japaneseCharactersPerMinute":800}')).toBeUndefined();
  });
});

const readAmount = { japaneseCharacters: 120, englishWords: 0, japaneseDurationMs: 12_000, englishDurationMs: 0 };

/** テスト用の読書位置を作る。 */
function readingPosition(unitIndex: number, unitCount: number, savedAt: number): ReadingPosition {
  return { unitIndex, unitCount, savedAt, playedMs: 15_000, readAmount };
}

describe("読書位置", () => {
  it("形の合わない項目を捨てて読む", () => {
    expect(
      parseReadingPositions(
        JSON.stringify({
          good: readingPosition(3, 10, 1),
          negative: readingPosition(-1, 10, 1),
          missing: { unitIndex: 3 },
          missingReadAmount: { ...readingPosition(3, 10, 1), readAmount: undefined },
          broken: null,
        }),
      ),
    ).toEqual({ good: readingPosition(3, 10, 1) });
    expect(parseReadingPositions("[")).toEqual({});
  });

  it("書き込むと同じハッシュの位置を上書きし、100 件を超えたら保存が古いものから捨てる", () => {
    const positions = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`hash${index}`, readingPosition(0, 1, index)]),
    );
    const updatedPositions = upsertReadingPosition(positions, "new", readingPosition(5, 9, 1000));
    expect(Object.keys(updatedPositions)).toHaveLength(100);
    expect(updatedPositions.new).toEqual(readingPosition(5, 9, 1000));
    expect(updatedPositions.hash0).toBeUndefined();
    expect(upsertReadingPosition(updatedPositions, "new", readingPosition(6, 9, 1001)).new).toEqual(
      readingPosition(6, 9, 1001),
    );
  });

  it("単位の数が合う時だけ続きの位置を、再生時間と読んだ量と一緒に返す", () => {
    expect(resumablePosition(readingPosition(3, 10, 0), 10)).toEqual(readingPosition(3, 10, 0));
    expect(resumablePosition(readingPosition(3, 10, 0), 11)).toBeUndefined();
    expect(resumablePosition(undefined, 10)).toBeUndefined();
  });
});

describe("段落ごとの区切りの位置", () => {
  it("形の合わない項目 (区切りが昇順でない・整数でない・保存時刻が無い) を捨てて読む", () => {
    expect(
      parseSavedParagraphBoundaries(
        JSON.stringify({
          good: { paragraphBoundaries: [null, [3, 8]], savedAt: 1 },
          unsorted: { paragraphBoundaries: [[8, 3]], savedAt: 1 },
          fraction: { paragraphBoundaries: [[1.5]], savedAt: 1 },
          zero: { paragraphBoundaries: [[0, 3]], savedAt: 1 },
          missingSavedAt: { paragraphBoundaries: [[3]] },
          broken: null,
        }),
      ),
    ).toEqual({ good: { paragraphBoundaries: [null, [3, 8]], savedAt: 1 } });
    expect(parseSavedParagraphBoundaries("[]")).toEqual({});
  });

  it("書き込むと同じハッシュの区切りを上書きし、50 件を超えたら保存が古いものから捨てる", () => {
    const saved = Object.fromEntries(
      Array.from({ length: 50 }, (_, index) => [`hash${index}`, { paragraphBoundaries: [[index + 1]], savedAt: index }]),
    );
    const updated = upsertParagraphBoundaries(saved, "new", [null, [2]], 1000);
    expect(Object.keys(updated)).toHaveLength(50);
    expect(updated.new).toEqual({ paragraphBoundaries: [null, [2]], savedAt: 1000 });
    expect(updated.hash0).toBeUndefined();
  });

  it("開く時は保存した区切りを優先し、BudouX だけで読み始めた本文には受け取った区切りを使わない", () => {
    const saved = [[3]];
    const received = [[5]];
    expect(paragraphBoundariesForOpening(saved, received, false)).toBe(saved);
    expect(paragraphBoundariesForOpening(undefined, received, false)).toBe(received);
    expect(paragraphBoundariesForOpening(undefined, received, true)).toBeUndefined();
    expect(paragraphBoundariesForOpening(undefined, undefined, false)).toBeUndefined();
  });
});

describe("読了の記録", () => {
  const record: FinishedReading = { finishedAt: 1000, japaneseCharacters: 500, englishWords: 0, playedMs: 60_000 };

  it("同じ読了を二度足しても 1 件にする", () => {
    expect(addFinishedReading(addFinishedReading([], record), record)).toEqual([record]);
  });

  it("形の合わない記録を捨てて読む", () => {
    expect(parseFinishedReadings(JSON.stringify([record, { finishedAt: "x" }, null]))).toEqual([record]);
    expect(parseFinishedReadings('{"a":1}')).toEqual([]);
  });

  it("日ごと・直近 7 日・全期間で合計する", () => {
    const now = new Date(2026, 8, 30, 12).getTime();
    const records: FinishedReading[] = [
      { finishedAt: new Date(2026, 8, 30, 9).getTime(), japaneseCharacters: 1000, englishWords: 0, playedMs: 1 },
      { finishedAt: new Date(2026, 8, 30, 21).getTime(), japaneseCharacters: 500, englishWords: 200, playedMs: 1 },
      { finishedAt: new Date(2026, 8, 24, 23).getTime(), japaneseCharacters: 300, englishWords: 0, playedMs: 1 },
      { finishedAt: new Date(2026, 8, 23, 23).getTime(), japaneseCharacters: 7000, englishWords: 10, playedMs: 1 },
    ];
    expect(summarizeFinishedReadings(records, now)).toEqual({
      lastSevenDays: { japaneseCharacters: 1800, englishWords: 200 },
      allTime: { japaneseCharacters: 8800, englishWords: 210 },
      days: [
        { date: "2026-09-30", japaneseCharacters: 1500, englishWords: 200 },
        { date: "2026-09-24", japaneseCharacters: 300, englishWords: 0 },
        { date: "2026-09-23", japaneseCharacters: 7000, englishWords: 10 },
      ],
    });
  });

  it("日付は端末の時刻帯の YYYY-MM-DD にする", () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe("2026-01-05");
  });
});

describe("英文を読んだ日の記録", () => {
  const now = new Date(2026, 8, 30, 12).getTime();

  it("日付の形でないキーと、形の合わない項目を捨てて読む", () => {
    expect(
      parseEnglishReadingDays(
        JSON.stringify({
          "2026-09-30": { englishRead: true, translationDisplayCount: 3 },
          "2026-9-1": { englishRead: true, translationDisplayCount: 1 },
          "2026-09-29": { englishRead: true, translationDisplayCount: -1 },
          "2026-09-27": { translationDisplayCount: 1 },
          "2026-09-28": null,
        }),
      ),
    ).toEqual({ "2026-09-30": { englishRead: true, translationDisplayCount: 3 } });
    expect(parseEnglishReadingDays("[]")).toEqual({});
    expect(parseEnglishReadingDays(null)).toEqual({});
  });

  it("英文を読んだ日にしても、その日の訳を出した回数を変えない", () => {
    expect(addEnglishReadingDay({}, now)).toEqual({ "2026-09-30": { englishRead: true, translationDisplayCount: 0 } });
    expect(addEnglishReadingDay(addTranslationDisplay({}, now), now)).toEqual({
      "2026-09-30": { englishRead: true, translationDisplayCount: 1 },
    });
  });

  it("訳を出すたびに、その日の回数を 1 つ増やし、訳を出しただけでは英文を読んだ日にしない", () => {
    expect(addTranslationDisplay(addTranslationDisplay({}, now), now)).toEqual({
      "2026-09-30": { englishRead: false, translationDisplayCount: 2 },
    });
    expect(addTranslationDisplay(addEnglishReadingDay({}, now), now)).toEqual({
      "2026-09-30": { englishRead: true, translationDisplayCount: 1 },
    });
  });

  it("直近 7 日の英文を読んだ日数と訳を出した日数、英文を読んだ日ごとの回数を新しい日から返す", () => {
    expect(
      summarizeEnglishReadingDays(
        {
          "2026-09-23": { englishRead: true, translationDisplayCount: 5 },
          "2026-09-30": { englishRead: true, translationDisplayCount: 2 },
          "2026-09-24": { englishRead: true, translationDisplayCount: 0 },
          "2026-09-28": { englishRead: true, translationDisplayCount: 1 },
          "2026-09-29": { englishRead: false, translationDisplayCount: 4 },
        },
        now,
      ),
    ).toEqual({
      lastSevenDaysEnglishReadingDayCount: 3,
      lastSevenDaysTranslationDisplayDayCount: 2,
      days: [
        { date: "2026-09-30", translationDisplayCount: 2 },
        { date: "2026-09-28", translationDisplayCount: 1 },
        { date: "2026-09-24", translationDisplayCount: 0 },
        { date: "2026-09-23", translationDisplayCount: 5 },
      ],
    });
  });
});

describe("hashText", () => {
  it("本文の SHA-256 を 16 進で返す", async () => {
    expect(await hashText("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
