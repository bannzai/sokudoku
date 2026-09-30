"use client";

import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { displayDurationMs, type ReadingSpeed } from "@/lib/displayDuration";
import {
  advance,
  createReaderState,
  moveBySentence,
  moveByUnits,
  pause,
  playedMsAt,
  playFrom,
  presentLanguages,
  type ReaderState,
  readingSummary,
  remainingDurationsMs,
  remainingFraction,
  restart,
  speedKeys,
  speedLimits,
  stepSpeed,
  togglePlay,
  unitIndexAtOffset,
} from "@/lib/readerState";
import {
  clearReadingPosition,
  type EnglishReadingDays,
  type FinishedReading,
  type FinishedReadingTotal,
  loadEnglishReadingDays,
  localDateKey,
  type ReadingPosition,
  recordEnglishReadingDay,
  recordFinishedReading,
  recordTranslationDisplay,
  saveReadingPosition,
  saveReadingSpeed,
  summarizeEnglishReadingDays,
  summarizeFinishedReadings,
} from "@/lib/readerStorage";
import type { Language, ReadingUnit, Sentence } from "@/lib/readingUnits";
import {
  applyDownloadProgress,
  applyTranslatorAvailability,
  applyTranslatorCreated,
  applyTranslatorCreationFailed,
  canToggleTranslation,
  initialTranslationState,
  startsCreatingTranslator,
  startsShowingTranslation,
  toggleTranslation,
  type TranslationState,
} from "@/lib/translationState";
import { checkTranslatorAvailability, createTranslator, type EnglishToJapaneseTranslator } from "@/lib/translator";
import styles from "./Reader.module.css";

/** 再生の画面に渡す値。 */
type ReadingSessionProps = {
  /** 取り込んだ本文。停止中の全文の表示にだけ使う。 */
  source: string;
  /** 本文を分割した単位。 */
  units: readonly ReadingUnit[];
  /** 本文の文。単位の sentenceIndex で引き、英文の訳の対象の文を取り出す。 */
  sentences: readonly Sentence[];
  /** 本文のハッシュ。読書位置の保存のキーにする。 */
  textHash: string;
  /** 前回の続きの位置と、そこまでの再生時間・読んだ量。undefined なら先頭から読む。 */
  resumedPosition?: ReadingPosition;
  /** 再生を始める時の速度。 */
  initialSpeed: ReadingSpeed;
  /** 取り込みの画面へ戻る。 */
  onClose: () => void;
};

/** 速度の設定欄の、言語ごとの見出しと速度の単位。 */
const speedLabels: Record<Language, { languageName: string; speedUnit: string }> = {
  ja: { languageName: "日本語", speedUnit: "文字/分" },
  en: { languageName: "英語", speedUnit: "語/分" },
};

/** マウスで押したボタンにフォーカスを残さない。残ると次の space がそのボタンを押し、再生・停止にならないため。 */
function keepFocusOffButton(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

/** 数を 3 桁区切りにする。 */
function formatNumber(value: number): string {
  return value.toLocaleString("ja-JP");
}

/** 再生した時間を「1 時間 2 分 3 秒」の形にする。 */
function formatPlayedTime(playedMs: number): string {
  const totalSeconds = Math.round(playedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours > 0 && `${hours} 時間`, (hours > 0 || minutes > 0) && `${minutes} 分`, `${seconds} 秒`]
    .filter(Boolean)
    .join(" ");
}

/** 残り時間の目安を「約 1 時間 2 分」の形にする。 */
function formatRemainingTime(remainingMs: number): string {
  const totalMinutes = Math.round(remainingMs / 60_000);
  if (totalMinutes < 1) {
    return "1 分未満";
  }
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0 ? `約 ${hours} 時間 ${totalMinutes % 60} 分` : `約 ${totalMinutes} 分`;
}

/** 読んだ量を「1,234 文字・56 語」の形にする。読んでいない言語は省く。 */
function formatReadAmount(total: FinishedReadingTotal): string {
  return (
    [
      total.japaneseCharacters > 0 && `${formatNumber(total.japaneseCharacters)} 文字`,
      total.englishWords > 0 && `${formatNumber(total.englishWords)} 語`,
    ]
      .filter(Boolean)
      .join("・") || "0 文字"
  );
}

/** 訳の切り替えボタンの横に出す、翻訳器の状態の説明。使えない理由とダウンロードの進み具合を出す。説明の要らない状態では undefined。 */
function translatorNotice(translationState: TranslationState): string | undefined {
  switch (translationState.translatorStatus) {
    case "checking":
      return "翻訳を使えるか確認中";
    case "unsupported":
      return "訳を出すにはデスクトップの Chrome 138 以降が必要です";
    case "unavailable":
      return "この端末では英語から日本語へ翻訳できません";
    case "downloadable":
      return "初めて訳を出す時に翻訳の言語モデルをダウンロードします";
    case "downloading":
      return "翻訳の言語モデルをダウンロード中";
    case "creating":
      return translationState.downloadProgress === undefined
        ? "翻訳の準備中"
        : `翻訳の言語モデルをダウンロード中 ${Math.round(translationState.downloadProgress * 100)}%`;
    case "failed":
      return "翻訳の準備に失敗しました (もう一度押すとやり直します)";
    case "available":
    case "ready":
      return undefined;
  }
}

/** 画面上の座標にある文字の位置 (テキストノードとその中の位置) を返す。 */
function caretAtPoint(x: number, y: number): { node: Node; offset: number } | undefined {
  // caretPositionFromPoint は Chrome 128・Safari 18.4 より前に無いため、WebKit 系の caretRangeFromPoint に切り替える
  if (typeof document.caretPositionFromPoint === "function") {
    const caretPosition = document.caretPositionFromPoint(x, y);
    return caretPosition ? { node: caretPosition.offsetNode, offset: caretPosition.offset } : undefined;
  }
  const caretRange = document.caretRangeFromPoint(x, y);
  return caretRange ? { node: caretRange.startContainer, offset: caretRange.startOffset } : undefined;
}

/** 停止中の全文に渡す値。 */
type FullTextProps = {
  /** 取り込んだ本文。 */
  source: string;
  /** ハイライトする現在の単位。 */
  currentUnit: ReadingUnit;
  /** 全文の中でクリックした位置 (元の文字列の UTF-16 のインデックス) を受け取る。 */
  onSelectOffset: (offset: number) => void;
};

/**
 * 停止中だけ出す全文。現在の単位をハイライトし、クリックした位置を元の文字列の位置で返す。
 * 本全体でも DOM が重くならないよう、単位ごとの要素にせず、現在の単位の前・現在の単位・後ろの 3 つに分けて出す。
 */
function FullText({ source, currentUnit, onSelectOffset }: FullTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentUnitRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (containerRef.current && currentUnitRef.current) {
      containerRef.current.scrollTop = currentUnitRef.current.offsetTop - containerRef.current.clientHeight / 2;
    }
  }, [currentUnit]);

  /** クリックした文字が、3 つに分けたどの部分の何文字目かから、元の文字列の位置を求める。 */
  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const caret = caretAtPoint(event.clientX, event.clientY);
    const partStart = Number(caret?.node.parentElement?.dataset.sourceOffset);
    if (caret && containerRef.current?.contains(caret.node) && Number.isInteger(partStart)) {
      onSelectOffset(partStart + caret.offset);
    }
  }

  return (
    <div ref={containerRef} className={styles.fullText} onClick={handleClick}>
      <span data-source-offset={0}>{source.slice(0, currentUnit.start)}</span>
      <mark ref={currentUnitRef} data-source-offset={currentUnit.start} className={styles.currentUnit}>
        {currentUnit.text}
      </mark>
      <span data-source-offset={currentUnit.end}>{source.slice(currentUnit.end)}</span>
    </div>
  );
}

/** 読了画面に渡す値。 */
type FinishedScreenProps = {
  /** 読了した時の再生の状態。 */
  readerState: ReaderState;
  /** 今回の読了を足した後の読了の記録。 */
  finishedReadings: readonly FinishedReading[];
  /** 英文を読んだ日ごとの、訳を出した回数。 */
  englishReadingDays: EnglishReadingDays;
  /** 先頭から読み直す。 */
  onRestart: () => void;
  /** 取り込みの画面へ戻る。 */
  onClose: () => void;
};

// 判定基準は週あたりの量のため、前の週と比べられる 2 週分を出す
const displayedDayCount = 14;

/** 読了画面。読んだ時間・量・実効速度と、読了の記録の集計を出す。内容の質問は出さない (ADR 0002)。 */
function FinishedScreen({ readerState, finishedReadings, englishReadingDays, onRestart, onClose }: FinishedScreenProps) {
  const summary = readingSummary(readerState);
  const finishedReadingSummary = summarizeFinishedReadings(finishedReadings, readerState.finishedAt ?? 0);
  const englishReadingDaysSummary = summarizeEnglishReadingDays(englishReadingDays, readerState.finishedAt ?? 0);
  return (
    <main className={styles.finished}>
      <h1 className={styles.title}>読了</h1>
      <dl className={styles.summary}>
        <dt>読んだ時間</dt>
        <dd>{formatPlayedTime(summary.playedMs)}</dd>
        <dt>読んだ量</dt>
        <dd>{formatReadAmount(summary)}</dd>
        {summary.japaneseCharactersPerMinute !== undefined && (
          <>
            <dt>実効速度 (日本語)</dt>
            <dd>{formatNumber(summary.japaneseCharactersPerMinute)} 文字/分</dd>
          </>
        )}
        {summary.englishWordsPerMinute !== undefined && (
          <>
            <dt>実効速度 (英語)</dt>
            <dd>{formatNumber(summary.englishWordsPerMinute)} 語/分</dd>
          </>
        )}
      </dl>
      <section className={styles.records}>
        <h2 className={styles.heading}>読了の記録</h2>
        <dl className={styles.summary}>
          <dt>直近 7 日</dt>
          <dd>{formatReadAmount(finishedReadingSummary.lastSevenDays)}</dd>
          <dt>累計</dt>
          <dd>{formatReadAmount(finishedReadingSummary.allTime)}</dd>
        </dl>
        <table className={styles.days}>
          <thead>
            <tr>
              <th>日付</th>
              <th>読んだ量</th>
            </tr>
          </thead>
          <tbody>
            {finishedReadingSummary.days.slice(0, displayedDayCount).map((day) => (
              <tr key={day.date}>
                <td>{day.date}</td>
                <td>{formatReadAmount(day)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {englishReadingDaysSummary.days.length > 0 && (
        <section className={styles.records}>
          <h2 className={styles.heading}>英文の訳の表示</h2>
          <dl className={styles.summary}>
            <dt>直近 7 日</dt>
            <dd>
              英文を読んだ日 {englishReadingDaysSummary.lastSevenDaysEnglishReadingDayCount} 日 ・ 訳を出した日{" "}
              {englishReadingDaysSummary.lastSevenDaysTranslationDisplayDayCount} 日
            </dd>
          </dl>
          <table className={styles.days}>
            <thead>
              <tr>
                <th>英文を読んだ日</th>
                <th>訳を出した回数</th>
              </tr>
            </thead>
            <tbody>
              {englishReadingDaysSummary.days.slice(0, displayedDayCount).map((day) => (
                <tr key={day.date}>
                  <td>{day.date}</td>
                  <td>{formatNumber(day.translationDisplayCount)} 回</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={onRestart}>
          最初から読む
        </button>
        <button type="button" className={styles.button} onClick={onClose}>
          別の本文を読む
        </button>
      </div>
    </main>
  );
}

/**
 * 再生の画面。単位を 1 つずつ画面中央に中央揃えで出し、停止中だけ全文と現在位置のハイライトを出す。
 * 再生中に全文を出さない・単位の中の文字の見た目を変えない・表示のクリックは一時停止と再開だけに使う (ADR 0002)。
 */
export function ReadingSession({
  source,
  units,
  sentences,
  textHash,
  resumedPosition,
  initialSpeed,
  onClose,
}: ReadingSessionProps) {
  const [readerState, setReaderState] = useState(() =>
    createReaderState({
      units,
      unitIndex: resumedPosition?.unitIndex ?? 0,
      speed: initialSpeed,
      playedMs: resumedPosition?.playedMs,
      readAmount: resumedPosition?.readAmount,
    }),
  );
  const [finishedReadings, setFinishedReadings] = useState<FinishedReading[]>([]);
  const [englishReadingDays, setEnglishReadingDays] = useState<EnglishReadingDays>({});
  const [translationState, setTranslationState] = useState(initialTranslationState);
  // 文の添字から訳への対応。null は訳せなかった文。本文ごとに作り直す画面 (key が本文のハッシュ) のため、本文を変えると捨てる
  const [sentenceTranslations, setSentenceTranslations] = useState<Record<number, string | null>>({});
  const translatorRef = useRef<EnglishToJapaneseTranslator>(undefined);
  // 訳している最中の文の添字。同じ文を二重に訳さないために持つ
  const translatingSentenceIndexesRef = useRef(new Set<number>());
  // 英文を読んだ日として保存済みの日付。英語の単位を表示し終えるたびに localStorage を書き直さないために持つ
  const recordedEnglishReadingDateRef = useRef<string>(undefined);
  const languages = useMemo(() => presentLanguages(units), [units]);
  const remainingDurations = useMemo(() => remainingDurationsMs(units, readerState.speed), [units, readerState.speed]);
  const hasEnglish = languages.includes("en");
  const currentSentenceIndex = units[readerState.unitIndex].sentenceIndex;

  // 英文を含む本文では、翻訳器を作れるかを先に確かめ、切り替えボタンを有効にするか・理由を出すかを決める
  useEffect(() => {
    if (!hasEnglish) {
      return;
    }
    void checkTranslatorAvailability().then((availability) =>
      setTranslationState((state) => applyTranslatorAvailability(state, availability)),
    );
  }, [hasEnglish]);

  useEffect(
    () => () => {
      translatorRef.current?.destroy();
      translatorRef.current = undefined;
    },
    [],
  );

  // 訳を表示している間は、今の文が英文で訳が無ければ訳す。訳は文ごとに残し、同じ文に戻った時は訳し直さない
  useEffect(() => {
    const translator = translatorRef.current;
    const sentence = sentences[currentSentenceIndex];
    if (
      !translationState.visible ||
      translationState.translatorStatus !== "ready" ||
      translator === undefined ||
      sentence.language !== "en" ||
      currentSentenceIndex in sentenceTranslations ||
      translatingSentenceIndexesRef.current.has(currentSentenceIndex)
    ) {
      return;
    }
    translatingSentenceIndexesRef.current.add(currentSentenceIndex);
    translator
      .translate(source.slice(sentence.start, sentence.end))
      .then(
        (translation) => setSentenceTranslations((translations) => ({ ...translations, [currentSentenceIndex]: translation })),
        () => setSentenceTranslations((translations) => ({ ...translations, [currentSentenceIndex]: null })),
      )
      .finally(() => translatingSentenceIndexesRef.current.delete(currentSentenceIndex));
  }, [
    currentSentenceIndex,
    sentenceTranslations,
    sentences,
    source,
    translationState.translatorStatus,
    translationState.visible,
  ]);

  /**
   * 訳の表示と非表示を切り替える。翻訳器の作成にユーザー操作が要るため、ボタン・T キーのイベントの中から呼ぶ。
   * 英文で訳を出した時は、その日の訳を出した回数を記録する。
   */
  const toggleTranslationDisplay = useCallback(() => {
    const nextTranslationState = toggleTranslation(translationState);
    setTranslationState(nextTranslationState);
    if (startsCreatingTranslator(translationState, nextTranslationState)) {
      createTranslator((loaded) => setTranslationState((state) => applyDownloadProgress(state, loaded))).then(
        (translator) => {
          translatorRef.current = translator;
          setTranslationState(applyTranslatorCreated);
        },
        () => setTranslationState(applyTranslatorCreationFailed),
      );
    }
    if (
      startsShowingTranslation(translationState, nextTranslationState) &&
      sentences[currentSentenceIndex].language === "en"
    ) {
      recordTranslationDisplay(Date.now());
    }
  }, [currentSentenceIndex, sentences, translationState]);

  // 表示中の単位の表示時間が経ったら次へ進む。状態が変わるたびに (移動・速度変更を含む) 表示時間を測り直す
  useEffect(() => {
    if (readerState.status !== "playing") {
      return;
    }
    const timeoutId = window.setTimeout(
      () => {
        const now = Date.now();
        if (
          units[readerState.unitIndex].language === "en" &&
          recordedEnglishReadingDateRef.current !== localDateKey(now)
        ) {
          recordEnglishReadingDay(now);
          recordedEnglishReadingDateRef.current = localDateKey(now);
        }
        const nextReaderState = advance(readerState, now);
        setReaderState(nextReaderState);
        if (nextReaderState.status === "finished" && nextReaderState.finishedAt !== undefined) {
          setEnglishReadingDays(loadEnglishReadingDays());
          const summary = readingSummary(nextReaderState);
          setFinishedReadings(
            recordFinishedReading({
              finishedAt: nextReaderState.finishedAt,
              japaneseCharacters: summary.japaneseCharacters,
              englishWords: summary.englishWords,
              playedMs: summary.playedMs,
            }),
          );
          clearReadingPosition(textHash);
        }
      },
      displayDurationMs(units[readerState.unitIndex], readerState.speed),
    );
    return () => window.clearTimeout(timeoutId);
  }, [readerState, textHash, units]);

  useEffect(() => {
    saveReadingSpeed(readerState.speed);
  }, [readerState.speed]);

  // 再生・停止・移動・単位の表示のたびに保存し、再生中にページを閉じても続きと読んだ量が残るようにする
  useEffect(() => {
    if (readerState.status !== "finished") {
      const now = Date.now();
      saveReadingPosition(textHash, {
        unitIndex: readerState.unitIndex,
        unitCount: units.length,
        savedAt: now,
        playedMs: playedMsAt(readerState, now),
        readAmount: readerState.readAmount,
      });
    }
  }, [readerState, textHash, units.length]);

  // 別のタブへ移る・端末をロックする等で画面が見えなくなったら止め、見ていない単位を読んだことにしない
  useEffect(() => {
    /** 画面が見えなくなった時に再生を止める。 */
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        setReaderState(pause(readerState, Date.now()));
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [readerState]);

  useEffect(() => {
    /** 画面のボタンと同じ操作を、キーボードからも行えるようにする。 */
    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || !(event.target instanceof Element)) {
        return;
      }
      // 入力欄のキー操作と、キーボードで選んだボタンの space での押下は、ブラウザの動作に任せる
      if (event.target.closest("input, textarea, select") || (event.key === " " && event.target.closest("button"))) {
        return;
      }
      if (hasEnglish && event.key.toLowerCase() === "t") {
        event.preventDefault();
        if (canToggleTranslation(translationState)) {
          toggleTranslationDisplay();
        }
        return;
      }
      const now = Date.now();
      const keyActions: Record<string, (state: ReaderState) => ReaderState> = {
        " ": (state) => togglePlay(state, now),
        ArrowLeft: (state) => (event.shiftKey ? moveBySentence(state, "previous") : moveByUnits(state, -1)),
        ArrowRight: (state) => (event.shiftKey ? moveBySentence(state, "next") : moveByUnits(state, 1)),
        ArrowUp: (state) => stepSpeed(state, languages, 1),
        ArrowDown: (state) => stepSpeed(state, languages, -1),
      };
      const keyAction = keyActions[event.key];
      if (keyAction === undefined) {
        return;
      }
      event.preventDefault();
      setReaderState(keyAction(readerState));
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasEnglish, languages, readerState, toggleTranslationDisplay, translationState]);

  if (readerState.status === "finished") {
    return (
      <FinishedScreen
        readerState={readerState}
        finishedReadings={finishedReadings}
        englishReadingDays={englishReadingDays}
        onRestart={() => setReaderState(restart(readerState))}
        onClose={onClose}
      />
    );
  }

  const currentUnit = units[readerState.unitIndex];
  const isPlaying = readerState.status === "playing";
  const remaining = remainingFraction(units, readerState.unitIndex);
  const currentSentenceTranslation = sentenceTranslations[currentSentenceIndex];
  const notice = translatorNotice(translationState);
  return (
    <main className={styles.session}>
      <div className={styles.progress}>
        <progress className={styles.progressBar} value={1 - remaining} max={1} />
        <p className={styles.progressText}>
          残り {Math.round(remaining * 100)}% ・ {formatRemainingTime(remainingDurations[readerState.unitIndex])}
        </p>
      </div>
      <button
        type="button"
        className={styles.display}
        onMouseDown={keepFocusOffButton}
        onClick={() => setReaderState(togglePlay(readerState, Date.now()))}
        aria-label={isPlaying ? "一時停止" : "再開"}
      >
        <span className={styles.unitText}>{currentUnit.text}</span>
      </button>
      {hasEnglish && (
        // 単位の表示の外 (下) に今の文の訳だけを出す。原文の文と訳を対にして並べない (ADR 0002)
        <p className={styles.translation} lang="ja" aria-live="polite">
          {translationState.visible &&
            sentences[currentSentenceIndex].language === "en" &&
            translationState.translatorStatus === "ready" &&
            (currentSentenceTranslation === undefined
              ? "訳しています"
              : (currentSentenceTranslation ?? "この文は訳せませんでした"))}
        </p>
      )}
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.button}
          onMouseDown={keepFocusOffButton}
          onClick={() => setReaderState(moveBySentence(readerState, "previous"))}
        >
          前の文
        </button>
        <button
          type="button"
          className={styles.button}
          onMouseDown={keepFocusOffButton}
          onClick={() => setReaderState(moveByUnits(readerState, -1))}
        >
          前へ
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.playButton}`}
          onMouseDown={keepFocusOffButton}
          onClick={() => setReaderState(togglePlay(readerState, Date.now()))}
        >
          {isPlaying ? "一時停止" : "再生"}
        </button>
        <button
          type="button"
          className={styles.button}
          onMouseDown={keepFocusOffButton}
          onClick={() => setReaderState(moveByUnits(readerState, 1))}
        >
          次へ
        </button>
        <button
          type="button"
          className={styles.button}
          onMouseDown={keepFocusOffButton}
          onClick={() => setReaderState(moveBySentence(readerState, "next"))}
        >
          次の文
        </button>
      </div>
      {hasEnglish && (
        <div className={styles.translationControls}>
          <button
            type="button"
            className={styles.button}
            onMouseDown={keepFocusOffButton}
            onClick={toggleTranslationDisplay}
            disabled={!canToggleTranslation(translationState)}
            aria-pressed={translationState.visible}
          >
            {translationState.visible ? "訳を隠す" : "訳を出す"}
          </button>
          {notice !== undefined && <span className={styles.note}>{notice}</span>}
        </div>
      )}
      <div className={styles.speeds}>
        {languages.map((language) => {
          const speedKey = speedKeys[language];
          const { languageName, speedUnit } = speedLabels[language];
          return (
            <div key={language} className={styles.speed}>
              <span>{languageName}</span>
              <button
                type="button"
                className={styles.button}
                onMouseDown={keepFocusOffButton}
                onClick={() => setReaderState(stepSpeed(readerState, [language], -1))}
                disabled={readerState.speed[speedKey] <= speedLimits[speedKey].min}
                aria-label={`${languageName}の速度を下げる`}
              >
                −
              </button>
              <span className={styles.speedValue}>
                {formatNumber(readerState.speed[speedKey])} {speedUnit}
              </span>
              <button
                type="button"
                className={styles.button}
                onMouseDown={keepFocusOffButton}
                onClick={() => setReaderState(stepSpeed(readerState, [language], 1))}
                disabled={readerState.speed[speedKey] >= speedLimits[speedKey].max}
                aria-label={`${languageName}の速度を上げる`}
              >
                +
              </button>
            </div>
          );
        })}
      </div>
      <p className={styles.keyHelp}>
        space 再生と一時停止 ・ ← → 1 単位 ・ shift + ← → 1 文 ・ ↑ ↓ 速度{hasEnglish && " ・ T 訳の出し入れ"}
      </p>
      {!isPlaying && (
        <section className={styles.fullTextSection}>
          <h2 className={styles.heading}>全文</h2>
          <p className={styles.note}>クリックした位置から再開します</p>
          <FullText
            source={source}
            currentUnit={currentUnit}
            onSelectOffset={(offset) =>
              setReaderState(playFrom(readerState, unitIndexAtOffset(units, offset), Date.now()))
            }
          />
          <button type="button" className={styles.button} onClick={onClose}>
            別の本文を読む
          </button>
        </section>
      )}
    </main>
  );
}
