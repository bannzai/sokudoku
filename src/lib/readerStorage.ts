import type { ReadingSpeed } from "./displayDuration";
import { speedLimits } from "./readerState";

/** 本文ごとの読書位置。本文そのものは保存せず、本文のハッシュをキーにする。 */
export type ReadingPosition = {
  /** 次に表示する単位の添字。 */
  unitIndex: number;
  /** 保存した時の単位の数。分割の方式が変わって単位の数が変わった本文では、位置を使わない。 */
  unitCount: number;
  /** 保存した時刻 (エポックミリ秒)。保存数の上限を超えた時に古いものから捨てるのに使う。 */
  savedAt: number;
};

/** 本文のハッシュから読書位置への対応。 */
export type ReadingPositions = Record<string, ReadingPosition>;

/** 1 回の読了の記録。documents/DIRECTION.md の判定基準「読了した文字数」を判定日に確かめるために残す。 */
export type FinishedReading = {
  /** 読了した時刻 (エポックミリ秒)。同じ読了を二重に記録しないための識別子も兼ねる。 */
  finishedAt: number;
  /** 読んだ日本語の文字数。 */
  japaneseCharacters: number;
  /** 読んだ英語の単語数。 */
  englishWords: number;
  /** 再生していた時間 (ミリ秒)。 */
  playedMs: number;
};

/** 日ごと・期間ごとの読了の合計。 */
export type FinishedReadingTotal = {
  /** 読んだ日本語の文字数の合計。 */
  japaneseCharacters: number;
  /** 読んだ英語の単語数の合計。 */
  englishWords: number;
};

/** 読了の記録の集計。 */
export type FinishedReadingSummary = {
  /** 今日を含む直近 7 日の合計。判定基準が週あたりの量のため。 */
  lastSevenDays: FinishedReadingTotal;
  /** すべての記録の合計。 */
  allTime: FinishedReadingTotal;
  /** 記録のある日ごとの合計を、新しい日から並べたもの。日付は端末の時刻帯の YYYY-MM-DD。 */
  days: (FinishedReadingTotal & { date: string })[];
};

const storageKeys = {
  readingSpeed: "sokudoku:reading-speed",
  readingPositions: "sokudoku:reading-positions",
  finishedReadings: "sokudoku:finished-readings",
};

// 読みかけの本文を同時に持つ数として十分な数。1 件は 100 バイトほどで、localStorage の容量 (5MB 前後) を圧迫しない
const maxReadingPositionCount = 100;

/** 値が 0 以上の整数かを返す。 */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** JSON を読む。壊れていれば undefined を返す。 */
function parseJson(json: string | null): unknown {
  if (json === null) {
    return undefined;
  }
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/** 保存した速度を読む。範囲外・壊れた値なら undefined を返す (呼び出し側が初期値を使う)。 */
export function parseReadingSpeed(json: string | null): ReadingSpeed | undefined {
  const value = parseJson(json);
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const { japaneseCharactersPerMinute, englishWordsPerMinute } = value as Record<string, unknown>;
  const isWithinLimit = (speed: unknown, key: keyof ReadingSpeed) =>
    typeof speed === "number" && speed >= speedLimits[key].min && speed <= speedLimits[key].max;
  return isWithinLimit(japaneseCharactersPerMinute, "japaneseCharactersPerMinute") &&
    isWithinLimit(englishWordsPerMinute, "englishWordsPerMinute")
    ? {
        japaneseCharactersPerMinute: japaneseCharactersPerMinute as number,
        englishWordsPerMinute: englishWordsPerMinute as number,
      }
    : undefined;
}

/** 保存した読書位置の対応を読む。形の合わない項目は捨てる。 */
export function parseReadingPositions(json: string | null): ReadingPositions {
  const value = parseJson(json);
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, position]) => {
      const { unitIndex, unitCount, savedAt } = (position ?? {}) as Record<string, unknown>;
      return isNonNegativeInteger(unitIndex) && isNonNegativeInteger(unitCount) && isNonNegativeInteger(savedAt);
    }),
  ) as ReadingPositions;
}

/** 保存した読了の記録を読む。形の合わない項目は捨てる。 */
export function parseFinishedReadings(json: string | null): FinishedReading[] {
  const value = parseJson(json);
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((record: unknown) => {
    const { finishedAt, japaneseCharacters, englishWords, playedMs } = (record ?? {}) as Record<string, unknown>;
    return [finishedAt, japaneseCharacters, englishWords, playedMs].every(isNonNegativeInteger);
  }) as FinishedReading[];
}

/** 本文の読書位置を書き込んだ対応を返す。上限を超えたら保存が古いものから捨てる。 */
export function upsertReadingPosition(
  positions: ReadingPositions,
  textHash: string,
  position: ReadingPosition,
): ReadingPositions {
  return Object.fromEntries(
    Object.entries({ ...positions, [textHash]: position })
      .sort(([, left], [, right]) => right.savedAt - left.savedAt)
      .slice(0, maxReadingPositionCount),
  );
}

/** 保存した位置が、今の本文の単位の数と合う時だけ位置を返す。 */
export function resumableUnitIndex(position: ReadingPosition | undefined, unitCount: number): number | undefined {
  return position !== undefined && position.unitCount === unitCount && position.unitIndex < unitCount
    ? position.unitIndex
    : undefined;
}

/** 読了の記録を足した一覧を返す。同じ finishedAt の記録が既にあれば足さない (同じ読了を二重に記録しない)。 */
export function addFinishedReading(records: readonly FinishedReading[], record: FinishedReading): FinishedReading[] {
  return records.some((existingRecord) => existingRecord.finishedAt === record.finishedAt)
    ? [...records]
    : [...records, record];
}

/** エポックミリ秒を、端末の時刻帯の YYYY-MM-DD にする。判定日に bannzai が自分の暦日で週の量を確かめるため。 */
export function localDateKey(epochMs: number): string {
  const date = new Date(epochMs);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

/** 読了の記録を、日ごと・直近 7 日・全期間で合計する。 */
export function summarizeFinishedReadings(records: readonly FinishedReading[], now: number): FinishedReadingSummary {
  const dayTotals = new Map<string, FinishedReadingTotal>();
  for (const record of records) {
    const date = localDateKey(record.finishedAt);
    const dayTotal = dayTotals.get(date) ?? { japaneseCharacters: 0, englishWords: 0 };
    dayTotals.set(date, {
      japaneseCharacters: dayTotal.japaneseCharacters + record.japaneseCharacters,
      englishWords: dayTotal.englishWords + record.englishWords,
    });
  }
  const today = new Date(now);
  const lastSevenDates = new Set(
    Array.from({ length: 7 }, (_, dayOffset) =>
      localDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - dayOffset).getTime()),
    ),
  );
  const days = [...dayTotals.entries()]
    .map(([date, dayTotal]) => ({ date, ...dayTotal }))
    .sort((left, right) => right.date.localeCompare(left.date));
  /** 日ごとの合計を足し合わせる。 */
  function sum(totals: readonly FinishedReadingTotal[]): FinishedReadingTotal {
    return {
      japaneseCharacters: totals.reduce((total, dayTotal) => total + dayTotal.japaneseCharacters, 0),
      englishWords: totals.reduce((total, dayTotal) => total + dayTotal.englishWords, 0),
    };
  }
  return {
    lastSevenDays: sum(days.filter((day) => lastSevenDates.has(day.date))),
    allTime: sum(days),
    days,
  };
}

/** 本文を識別するハッシュ (SHA-256 の 16 進) を返す。本文そのものを保存しないため、位置の保存にはこれを使う。 */
export async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** localStorage から読む。プライベートブラウズ等で使えない時は null を返し、保存の無い状態として扱う。 */
function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** localStorage に書く。容量超過やプライベートブラウズで書けない時は、保存せずに読書を続ける。 */
function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 保存できなくても再生には影響しないため、何もしない
  }
}

/** 保存した速度を読む。 */
export function loadReadingSpeed(): ReadingSpeed | undefined {
  return parseReadingSpeed(readStorage(storageKeys.readingSpeed));
}

/** 速度を保存する。 */
export function saveReadingSpeed(speed: ReadingSpeed) {
  writeStorage(storageKeys.readingSpeed, JSON.stringify(speed));
}

/** 本文のハッシュと単位の数から、続きから読む単位の添字を読む。 */
export function loadReadingPosition(textHash: string, unitCount: number): number | undefined {
  return resumableUnitIndex(parseReadingPositions(readStorage(storageKeys.readingPositions))[textHash], unitCount);
}

/** 本文の読書位置を保存する。 */
export function saveReadingPosition(textHash: string, position: ReadingPosition) {
  writeStorage(
    storageKeys.readingPositions,
    JSON.stringify(
      upsertReadingPosition(parseReadingPositions(readStorage(storageKeys.readingPositions)), textHash, position),
    ),
  );
}

/** 読了した本文の読書位置を消す。次に開いた時は先頭から読む。 */
export function clearReadingPosition(textHash: string) {
  const positions = parseReadingPositions(readStorage(storageKeys.readingPositions));
  delete positions[textHash];
  writeStorage(storageKeys.readingPositions, JSON.stringify(positions));
}

/** 読了の記録を足して保存し、保存後の一覧を返す。 */
export function recordFinishedReading(record: FinishedReading): FinishedReading[] {
  const records = addFinishedReading(parseFinishedReadings(readStorage(storageKeys.finishedReadings)), record);
  writeStorage(storageKeys.finishedReadings, JSON.stringify(records));
  return records;
}
