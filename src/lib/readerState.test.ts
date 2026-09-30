import { describe, expect, it } from "vitest";
import {
  advance,
  createReaderState,
  moveBySentence,
  moveByUnits,
  pause,
  play,
  playedMsAt,
  playFrom,
  presentLanguages,
  type ReaderState,
  readingSummary,
  remainingDurationsMs,
  remainingFraction,
  restart,
  stepSpeed,
  togglePlay,
  unitIndexAtOffset,
} from "./readerState";
import { segmentText } from "./readingUnits";

const speed = { japaneseCharactersPerMinute: 600, englishWordsPerMinute: 300 };

// 文 0: 吾輩は / 猫である。  文 1: 名前は / まだ / 無い。
const japaneseUnits = segmentText("吾輩は猫である。名前はまだ無い。").units;

/** 停止中の状態から、指定した時刻に再生を始めた状態を作る。 */
function playingState(unitIndex: number, now = 0): ReaderState {
  return play(createReaderState({ units: japaneseUnits, unitIndex, speed }), now);
}

/** 再生を始めてから、各単位の表示時間どおりに最後まで進めた状態を返す。 */
function playToEnd(state: ReaderState, startedAt: number): ReaderState {
  let currentState = play(state, startedAt);
  let now = startedAt;
  const durations = remainingDurationsMs(currentState.units, currentState.speed);
  while (currentState.status === "playing") {
    now += durations[currentState.unitIndex] - durations[currentState.unitIndex + 1];
    currentState = advance(currentState, now);
  }
  return currentState;
}

describe("createReaderState", () => {
  it("停止中で始まり、前回の位置が単位の数を超えていれば最後の単位に収める", () => {
    const state = createReaderState({ units: japaneseUnits, unitIndex: 99, speed });
    expect(state.status).toBe("paused");
    expect(state.unitIndex).toBe(4);
  });

  it("前回の続きから読む時は、前回までの再生時間と読んだ量を引き継いで読了まで足し続ける", () => {
    const previousReadAmount = { japaneseCharacters: 8, englishWords: 0, japaneseDurationMs: 1300, englishDurationMs: 0 };
    const resumed = createReaderState({
      units: japaneseUnits,
      unitIndex: 2,
      speed,
      playedMs: 5000,
      readAmount: previousReadAmount,
    });
    const finished = playToEnd(resumed, 0);
    expect(finished.playedMs).toBe(5000 + 1800);
    expect(finished.readAmount.japaneseCharacters).toBe(16);
  });
});

describe("playedMsAt", () => {
  it("再生中は現在の再生区間を足し、停止中は playedMs をそのまま返す", () => {
    const playing = play(createReaderState({ units: japaneseUnits, unitIndex: 0, speed, playedMs: 1000 }), 2000);
    expect(playedMsAt(playing, 2500)).toBe(1500);
    expect(playedMsAt(pause(playing, 3000), 9999)).toBe(2000);
  });
});

describe("再生と停止", () => {
  it("停止中から再生し、停止すると再生していた時間を足す", () => {
    const playingAtTime1000 = play(createReaderState({ units: japaneseUnits, unitIndex: 0, speed }), 1000);
    expect(playingAtTime1000.status).toBe("playing");
    const pausedAtTime3500 = pause(playingAtTime1000, 3500);
    expect(pausedAtTime3500).toMatchObject({ status: "paused", playedMs: 2500, playingSince: undefined });
    expect(pause(play(pausedAtTime3500, 10_000), 10_500).playedMs).toBe(3000);
  });

  it("togglePlay は再生中なら止め、停止中なら再生する", () => {
    const playing = togglePlay(createReaderState({ units: japaneseUnits, unitIndex: 0, speed }), 0);
    expect(playing.status).toBe("playing");
    expect(togglePlay(playing, 100).status).toBe("paused");
  });

  it("停止中の advance は何もしない", () => {
    const paused = createReaderState({ units: japaneseUnits, unitIndex: 0, speed });
    expect(advance(paused, 100)).toBe(paused);
  });
});

describe("advance と読了", () => {
  it("次の単位へ進み、表示し終えた単位の文字数を数える", () => {
    const advanced = advance(playingState(0), 300);
    expect(advanced.unitIndex).toBe(1);
    expect(advanced.readAmount).toEqual({
      japaneseCharacters: 3,
      englishWords: 0,
      japaneseDurationMs: 300,
      englishDurationMs: 0,
    });
  });

  it("最後の単位を表示し終えると読了にし、読了の時刻と再生していた時間を持つ", () => {
    const finished = playToEnd(createReaderState({ units: japaneseUnits, unitIndex: 0, speed }), 1000);
    expect(finished).toMatchObject({ status: "finished", unitIndex: 4, playedMs: 3100, finishedAt: 4100 });
    expect(finished.readAmount.japaneseCharacters).toBe(16);
  });

  it("読了後は再生・移動・速度変更を受け付けない", () => {
    const finished = playToEnd(createReaderState({ units: japaneseUnits, unitIndex: 0, speed }), 0);
    expect(play(finished, 5000)).toBe(finished);
    expect(moveByUnits(finished, -1)).toBe(finished);
    expect(moveBySentence(finished, "previous")).toBe(finished);
    expect(stepSpeed(finished, ["ja"], 1)).toBe(finished);
  });

  it("restart は先頭の停止中に戻し、読んだ量と再生時間を捨てて速度は残す", () => {
    const finished = playToEnd(
      createReaderState({ units: japaneseUnits, unitIndex: 0, speed: { ...speed, japaneseCharactersPerMinute: 900 } }),
      0,
    );
    expect(restart(finished)).toEqual(
      createReaderState({ units: japaneseUnits, unitIndex: 0, speed: { ...speed, japaneseCharactersPerMinute: 900 } }),
    );
  });
});

describe("前後の移動", () => {
  it("1 単位ずつ移り、先頭・末尾より外へは出ない。再生中は再生したまま移る", () => {
    expect(moveByUnits(playingState(2), 1)).toMatchObject({ unitIndex: 3, status: "playing" });
    expect(moveByUnits(playingState(0), -1).unitIndex).toBe(0);
    expect(moveByUnits(playingState(4), 1).unitIndex).toBe(4);
  });

  it("前の文へ: 文の途中なら今の文の先頭へ、文の先頭なら前の文の先頭へ移る", () => {
    expect(moveBySentence(playingState(3), "previous").unitIndex).toBe(2);
    expect(moveBySentence(playingState(2), "previous").unitIndex).toBe(0);
    expect(moveBySentence(playingState(0), "previous").unitIndex).toBe(0);
  });

  it("次の文へ: 次の文の先頭へ移り、最後の文なら移らない", () => {
    expect(moveBySentence(playingState(0), "next").unitIndex).toBe(2);
    expect(moveBySentence(playingState(3), "next").unitIndex).toBe(3);
  });

  it("全文で選んだ単位から再生を始める", () => {
    expect(playFrom(createReaderState({ units: japaneseUnits, unitIndex: 0, speed }), 3, 500)).toMatchObject({
      unitIndex: 3,
      status: "playing",
      playingSince: 500,
    });
  });
});

describe("stepSpeed", () => {
  it("指定した言語の速度だけを幅の倍数で上げ下げする", () => {
    expect(stepSpeed(playingState(0), ["ja"], 2).speed).toEqual({
      japaneseCharactersPerMinute: 700,
      englishWordsPerMinute: 300,
    });
    expect(stepSpeed(playingState(0), ["ja", "en"], -1).speed).toEqual({
      japaneseCharactersPerMinute: 550,
      englishWordsPerMinute: 275,
    });
  });

  it("上限・下限を超えない", () => {
    expect(stepSpeed(playingState(0), ["ja", "en"], -100).speed).toEqual({
      japaneseCharactersPerMinute: 100,
      englishWordsPerMinute: 50,
    });
    expect(stepSpeed(playingState(0), ["ja", "en"], 100).speed).toEqual({
      japaneseCharactersPerMinute: 3000,
      englishWordsPerMinute: 1500,
    });
  });
});

describe("unitIndexAtOffset", () => {
  const { units } = segmentText("Yes, it was.\nThe end.");

  it("位置を含む単位を返す", () => {
    expect(unitIndexAtOffset(units, 0)).toBe(0);
    expect(unitIndexAtOffset(units, 6)).toBe(1);
    expect(unitIndexAtOffset(units, 14)).toBe(3);
  });

  it("単位の間の空白・改行なら後ろの単位を、末尾より後ろなら最後の単位を返す", () => {
    expect(unitIndexAtOffset(units, 4)).toBe(1);
    expect(unitIndexAtOffset(units, 12)).toBe(3);
    expect(unitIndexAtOffset(units, 100)).toBe(4);
  });
});

describe("進み具合", () => {
  it("remainingDurationsMs は各単位から末尾までの表示時間の合計を返す", () => {
    expect(remainingDurationsMs(japaneseUnits, speed)).toEqual([3100, 2800, 1800, 1500, 1300, 0]);
  });

  it("remainingFraction は現在の単位から末尾までの文字の割合を返す", () => {
    expect(remainingFraction(japaneseUnits, 0)).toBe(1);
    expect(remainingFraction(japaneseUnits, 2)).toBe(8 / 16);
  });
});

describe("readingSummary", () => {
  it("読んだ文字数を再生していた時間で割って実効速度を出す", () => {
    const finished = playToEnd(createReaderState({ units: japaneseUnits, unitIndex: 0, speed }), 0);
    expect(readingSummary(finished)).toEqual({
      playedMs: 3100,
      japaneseCharacters: 16,
      englishWords: 0,
      japaneseCharactersPerMinute: 310,
      englishWordsPerMinute: undefined,
    });
  });

  it("日本語と英語が混ざる本文は、再生していた時間を表示時間の比で按分する", () => {
    // GitHub (200ms) / Pages (200ms) / で (100ms) / 配信する。 (1500ms)。日本語 1600ms と英語 400ms で 4:1 に分ける
    const mixedUnits = segmentText("GitHub Pages で配信する。").units;
    let state = play(createReaderState({ units: mixedUnits, unitIndex: 0, speed }), 0);
    for (let now = 1000; state.status === "playing"; now += 1000) {
      state = advance(state, now);
    }
    expect(readingSummary(state)).toEqual({
      playedMs: 4000,
      japaneseCharacters: 6,
      englishWords: 2,
      japaneseCharactersPerMinute: 113,
      englishWordsPerMinute: 150,
    });
  });

  it("再生していない時は実効速度を出さない", () => {
    expect(readingSummary(createReaderState({ units: japaneseUnits, unitIndex: 0, speed }))).toMatchObject({
      japaneseCharactersPerMinute: undefined,
      englishWordsPerMinute: undefined,
    });
  });
});

describe("presentLanguages", () => {
  it("本文に含まれる言語を日本語・英語の順に返す", () => {
    expect(presentLanguages(japaneseUnits)).toEqual(["ja"]);
    expect(presentLanguages(segmentText("Hello 世界。").units)).toEqual(["ja", "en"]);
  });
});
