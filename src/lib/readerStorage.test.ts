import { describe, expect, it } from "vitest";
import {
  addFinishedReading,
  type FinishedReading,
  hashText,
  localDateKey,
  parseFinishedReadings,
  parseReadingPositions,
  parseReadingSpeed,
  resumableUnitIndex,
  summarizeFinishedReadings,
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

describe("読書位置", () => {
  it("形の合わない項目を捨てて読む", () => {
    expect(
      parseReadingPositions(
        JSON.stringify({
          good: { unitIndex: 3, unitCount: 10, savedAt: 1 },
          negative: { unitIndex: -1, unitCount: 10, savedAt: 1 },
          missing: { unitIndex: 3 },
          broken: null,
        }),
      ),
    ).toEqual({ good: { unitIndex: 3, unitCount: 10, savedAt: 1 } });
    expect(parseReadingPositions("[")).toEqual({});
  });

  it("書き込むと同じハッシュの位置を上書きし、100 件を超えたら保存が古いものから捨てる", () => {
    const positions = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`hash${index}`, { unitIndex: 0, unitCount: 1, savedAt: index }]),
    );
    const updatedPositions = upsertReadingPosition(positions, "new", { unitIndex: 5, unitCount: 9, savedAt: 1000 });
    expect(Object.keys(updatedPositions)).toHaveLength(100);
    expect(updatedPositions.new).toEqual({ unitIndex: 5, unitCount: 9, savedAt: 1000 });
    expect(updatedPositions.hash0).toBeUndefined();
    expect(upsertReadingPosition(updatedPositions, "new", { unitIndex: 6, unitCount: 9, savedAt: 1001 }).new).toEqual({
      unitIndex: 6,
      unitCount: 9,
      savedAt: 1001,
    });
  });

  it("単位の数が合う時だけ続きの位置を返す", () => {
    expect(resumableUnitIndex({ unitIndex: 3, unitCount: 10, savedAt: 0 }, 10)).toBe(3);
    expect(resumableUnitIndex({ unitIndex: 3, unitCount: 10, savedAt: 0 }, 11)).toBeUndefined();
    expect(resumableUnitIndex(undefined, 10)).toBeUndefined();
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

describe("hashText", () => {
  it("本文の SHA-256 を 16 進で返す", async () => {
    expect(await hashText("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
