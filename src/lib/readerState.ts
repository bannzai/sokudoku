import { displayDurationMs, japaneseCharacterCount, type ReadingSpeed } from "./displayDuration";
import type { Language, ReadingUnit } from "./readingUnits";

/** 再生の状態。読了は最後の単位を表示し終えた状態で、再生・移動・速度変更を受け付けない。 */
export type ReaderStatus = "paused" | "playing" | "finished";

/** 表示し終えた単位の量。読了画面の文字数・単語数と実効速度の計算に使う。 */
export type ReadAmount = {
  /** 表示し終えた日本語の単位の文字数の合計 (japaneseCharacterCount の数え方)。 */
  japaneseCharacters: number;
  /** 表示し終えた英語の単位の数 (1 単位 = 1 単語)。 */
  englishWords: number;
  /** 表示し終えた日本語の単位の表示時間の合計 (その時点の速度で計算)。再生した時間を日本語と英語に按分するのに使う。 */
  japaneseDurationMs: number;
  /** 表示し終えた英語の単位の表示時間の合計 (その時点の速度で計算)。 */
  englishDurationMs: number;
};

/** リーダー画面の再生の状態。本文の単位・現在位置・速度・再生した時間・読んだ量を持つ。 */
export type ReaderState = {
  /** 表示する単位を先頭から並べたもの。segmentText の units をそのまま持つ。 */
  units: readonly ReadingUnit[];
  /** 表示中の単位の添字。停止中は、再開した時に最初に表示する単位を指す。 */
  unitIndex: number;
  /** 再生の状態。 */
  status: ReaderStatus;
  /** 読む速度。 */
  speed: ReadingSpeed;
  /** 再生していた時間の合計 (ミリ秒)。停止中の時間と、現在の再生区間 (playingSince から後) は含めない。 */
  playedMs: number;
  /** 現在の再生を始めた時刻 (エポックミリ秒)。再生中だけ値を持つ。 */
  playingSince?: number;
  /** 表示し終えた単位の量。 */
  readAmount: ReadAmount;
  /** 読了した時刻 (エポックミリ秒)。読了した時だけ値を持つ。 */
  finishedAt?: number;
};

/** 速度 1 種類の上げ下げの範囲と幅。 */
type SpeedLimit = {
  /** 下限。displayDurationMs が 0 以下の速度で例外を投げるため、0 より大きくする。 */
  min: number;
  /** 上限。 */
  max: number;
  /** 1 回の上げ下げの幅。 */
  step: number;
};

// 日本語の初期値は、documents/PROJECT.md のきっかけの投稿 (18 万文字を 3 時間 = 1 分あたり 1,000 文字) の 6 割にし、慣れるまでの余裕をとる。
// 英語の初期値は、黙読の平均 (Brysbaert 2019 のメタ分析で 1 分あたり 238〜260 語) を少し上回る 300 語にする
export const defaultReadingSpeed: ReadingSpeed = { japaneseCharactersPerMinute: 600, englishWordsPerMinute: 300 };

// 下限は初期値の 1/6 (日本語は平均的な 5 文字の文節を 3 秒、英語は 1 単語を 1.2 秒) で、これより遅く読む用途は想定しない。
// 上限は初期値の 5 倍 (日本語はきっかけの投稿の 3 倍)。幅は初期値から 12 回で 2 倍になる大きさで、使いながら調整する
export const speedLimits: Record<keyof ReadingSpeed, SpeedLimit> = {
  japaneseCharactersPerMinute: { min: 100, max: 3000, step: 50 },
  englishWordsPerMinute: { min: 50, max: 1500, step: 25 },
};

const emptyReadAmount: ReadAmount = {
  japaneseCharacters: 0,
  englishWords: 0,
  japaneseDurationMs: 0,
  englishDurationMs: 0,
};

/** 言語ごとの速度のキー。 */
export const speedKeys: Record<Language, keyof ReadingSpeed> = {
  ja: "japaneseCharactersPerMinute",
  en: "englishWordsPerMinute",
};

/** 値を [min, max] に収める。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 停止中の状態を作る。unitIndex は本文の範囲に収める (前回の位置が本文の単位の数を超えていても壊れないように)。 */
export function createReaderState(params: {
  units: readonly ReadingUnit[];
  unitIndex: number;
  speed: ReadingSpeed;
}): ReaderState {
  return {
    units: params.units,
    unitIndex: clamp(params.unitIndex, 0, Math.max(params.units.length - 1, 0)),
    status: "paused",
    speed: params.speed,
    playedMs: 0,
    readAmount: emptyReadAmount,
  };
}

/** 現在位置から再生を始める。再生中・読了後・単位が無い時は何もしない。 */
export function play(state: ReaderState, now: number): ReaderState {
  if (state.status !== "paused" || state.units.length === 0) {
    return state;
  }
  return { ...state, status: "playing", playingSince: now };
}

/** 再生を止め、ここまでの再生区間の時間を playedMs に足す。再生中でなければ何もしない。 */
export function pause(state: ReaderState, now: number): ReaderState {
  if (state.status !== "playing" || state.playingSince === undefined) {
    return state;
  }
  return {
    ...state,
    status: "paused",
    playedMs: state.playedMs + (now - state.playingSince),
    playingSince: undefined,
  };
}

/** 再生中なら止め、停止中なら再生する。 */
export function togglePlay(state: ReaderState, now: number): ReaderState {
  return state.status === "playing" ? pause(state, now) : play(state, now);
}

/**
 * 表示中の単位の表示時間が経った時に呼ぶ。表示し終えた単位の量を足し、次の単位へ進む。
 * 最後の単位なら読了にする。再生中でなければ何もしない。
 */
export function advance(state: ReaderState, now: number): ReaderState {
  if (state.status !== "playing" || state.playingSince === undefined) {
    return state;
  }
  const unit = state.units[state.unitIndex];
  const unitDurationMs = displayDurationMs(unit, state.speed);
  const readAmount: ReadAmount =
    unit.language === "ja"
      ? {
          ...state.readAmount,
          japaneseCharacters: state.readAmount.japaneseCharacters + japaneseCharacterCount(unit.text),
          japaneseDurationMs: state.readAmount.japaneseDurationMs + unitDurationMs,
        }
      : {
          ...state.readAmount,
          englishWords: state.readAmount.englishWords + 1,
          englishDurationMs: state.readAmount.englishDurationMs + unitDurationMs,
        };
  if (state.unitIndex === state.units.length - 1) {
    return {
      ...state,
      status: "finished",
      playedMs: state.playedMs + (now - state.playingSince),
      playingSince: undefined,
      readAmount,
      finishedAt: now,
    };
  }
  return { ...state, unitIndex: state.unitIndex + 1, readAmount };
}

/** 指定した単位へ移る。範囲外は先頭・末尾に収める。再生中は再生したまま移る。読了後は何もしない。 */
function moveTo(state: ReaderState, unitIndex: number): ReaderState {
  if (state.status === "finished") {
    return state;
  }
  return { ...state, unitIndex: clamp(unitIndex, 0, state.units.length - 1) };
}

/** 単位の数だけ前後へ移る (負の数で前へ)。 */
export function moveByUnits(state: ReaderState, unitDelta: number): ReaderState {
  return moveTo(state, state.unitIndex + unitDelta);
}

/** 指定した単位が属する文の、先頭の単位の添字を返す。 */
function sentenceFirstUnitIndex(units: readonly ReadingUnit[], unitIndex: number): number {
  let firstUnitIndex = unitIndex;
  while (firstUnitIndex > 0 && units[firstUnitIndex - 1].sentenceIndex === units[unitIndex].sentenceIndex) {
    firstUnitIndex -= 1;
  }
  return firstUnitIndex;
}

/**
 * 1 文だけ前後へ移る。移る先は文の先頭の単位。
 * 前へ移る時、現在の単位が文の先頭でなければ現在の文の先頭へ戻る (音楽プレーヤーの「前へ」と同じ)。
 * 後ろに文が無ければ移らない。
 */
export function moveBySentence(state: ReaderState, direction: "previous" | "next"): ReaderState {
  if (state.status === "finished" || state.units.length === 0) {
    return state;
  }
  const currentSentenceFirstUnitIndex = sentenceFirstUnitIndex(state.units, state.unitIndex);
  if (direction === "previous") {
    return moveTo(
      state,
      state.unitIndex > currentSentenceFirstUnitIndex
        ? currentSentenceFirstUnitIndex
        : sentenceFirstUnitIndex(state.units, Math.max(currentSentenceFirstUnitIndex - 1, 0)),
    );
  }
  const nextSentenceFirstUnitIndex = state.units.findIndex(
    (unit, unitIndex) => unitIndex > state.unitIndex && unit.sentenceIndex !== state.units[state.unitIndex].sentenceIndex,
  );
  return nextSentenceFirstUnitIndex === -1 ? state : moveTo(state, nextSentenceFirstUnitIndex);
}

/** 停止中の全文で選んだ単位から再生を始める。 */
export function playFrom(state: ReaderState, unitIndex: number, now: number): ReaderState {
  return play(moveTo(state, unitIndex), now);
}

/** 指定した言語の速度を、幅 (speedLimits の step) の倍数だけ上げ下げする (負の数で下げる)。範囲外は上限・下限に収める。 */
export function stepSpeed(state: ReaderState, languages: readonly Language[], stepDelta: number): ReaderState {
  if (state.status === "finished") {
    return state;
  }
  const speed = { ...state.speed };
  for (const language of languages) {
    const speedKey = speedKeys[language];
    const speedLimit = speedLimits[speedKey];
    speed[speedKey] = clamp(speed[speedKey] + speedLimit.step * stepDelta, speedLimit.min, speedLimit.max);
  }
  return { ...state, speed };
}

/** 先頭から読み直すため、読んだ量と再生した時間を捨てた停止中の状態に戻す。 */
export function restart(state: ReaderState): ReaderState {
  return createReaderState({ units: state.units, unitIndex: 0, speed: state.speed });
}

/** 本文に含まれる言語を、日本語・英語の順に返す。速度の設定欄とキーボードでの速度変更の対象を決めるのに使う。 */
export function presentLanguages(units: readonly ReadingUnit[]): Language[] {
  return (["ja", "en"] as const).filter((language) => units.some((unit) => unit.language === language));
}

/**
 * 元の文字列の位置 (UTF-16 のインデックス) にある単位の添字を返す。
 * 単位と単位の間の空白・改行の位置なら、その後ろの単位を返す。末尾より後ろなら最後の単位を返す。
 */
export function unitIndexAtOffset(units: readonly ReadingUnit[], offset: number): number {
  // start が offset 以下の最後の単位を二分探索で探す
  let low = 0;
  let high = units.length - 1;
  let foundUnitIndex = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (units[middle].start <= offset) {
      foundUnitIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (foundUnitIndex === -1) {
    return 0;
  }
  return offset < units[foundUnitIndex].end ? foundUnitIndex : Math.min(foundUnitIndex + 1, units.length - 1);
}

/**
 * 各位置から末尾までの表示時間の合計 (ミリ秒) を返す。添字 i の値は、単位 i から最後の単位までを表示し終えるまでの時間。
 * 残り時間の目安に使う。速度を変えるたびに作り直す。
 */
export function remainingDurationsMs(units: readonly ReadingUnit[], speed: ReadingSpeed): number[] {
  const durations = new Array<number>(units.length + 1).fill(0);
  for (let unitIndex = units.length - 1; unitIndex >= 0; unitIndex -= 1) {
    durations[unitIndex] = durations[unitIndex + 1] + displayDurationMs(units[unitIndex], speed);
  }
  return durations;
}

/** 現在の単位から末尾までが、本文全体 (最初の単位の先頭から最後の単位の末尾まで) に占める割合 (0〜1) を、元の文字列の長さで返す。 */
export function remainingFraction(units: readonly ReadingUnit[], unitIndex: number): number {
  if (units.length === 0) {
    return 0;
  }
  const textEnd = units[units.length - 1].end;
  return (textEnd - units[unitIndex].start) / (textEnd - units[0].start);
}

/** 読了画面に出す、読んだ量と実効速度。 */
export type ReadingSummary = {
  /** 再生していた時間 (ミリ秒)。停止中の時間は含めない。 */
  playedMs: number;
  /** 読んだ日本語の文字数。 */
  japaneseCharacters: number;
  /** 読んだ英語の単語数。 */
  englishWords: number;
  /** 日本語の実効速度 (1 分あたりの文字数)。日本語を読んでいない時と、再生時間が 0 の時は undefined。 */
  japaneseCharactersPerMinute?: number;
  /** 英語の実効速度 (1 分あたりの単語数)。英語を読んでいない時と、再生時間が 0 の時は undefined。 */
  englishWordsPerMinute?: number;
};

/**
 * 読んだ量と実効速度を返す。実効速度は、再生していた時間 (停止中を除き、速度変更や前後の移動を含む実際の時間) で割る。
 * 日本語と英語が混ざる本文では、再生していた時間を表示し終えた単位の表示時間の比で按分してから割る。
 */
export function readingSummary(state: ReaderState): ReadingSummary {
  const { japaneseCharacters, englishWords, japaneseDurationMs, englishDurationMs } = state.readAmount;
  const totalDurationMs = japaneseDurationMs + englishDurationMs;
  /** 按分した再生時間 1 分あたりの量を返す。量か時間が 0 なら undefined。 */
  function perMinute(amount: number, durationMs: number): number | undefined {
    // 整数どうしの積を最後に 1 回だけ割り、按分の途中の丸め誤差で四捨五入の結果が変わらないようにする
    return amount > 0 && state.playedMs > 0
      ? Math.round((amount * 60_000 * totalDurationMs) / (state.playedMs * durationMs))
      : undefined;
  }
  return {
    playedMs: state.playedMs,
    japaneseCharacters,
    englishWords,
    japaneseCharactersPerMinute: perMinute(japaneseCharacters, japaneseDurationMs),
    englishWordsPerMinute: perMinute(englishWords, englishDurationMs),
  };
}
