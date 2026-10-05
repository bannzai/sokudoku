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
  containsEnglishSentence,
  initialTranslationState,
  isTranslationDisplayed,
  startsCreatingTranslator,
  toggleTranslation,
  type TranslationState,
} from "@/lib/translationState";
import { checkTranslatorAvailability, createTranslator, type EnglishToJapaneseTranslator } from "@/lib/translator";
import { AppBar } from "./AppBar";
import buttonStyles from "./Button.module.css";
import styles from "./Reader.module.css";
import stageStyles from "./UnitStage.module.css";

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

/** 読了の結果に渡す値。 */
type FinishedSummaryProps = {
  /** 読了した時の再生の状態。 */
  readerState: ReaderState;
  /** 今回の読了を足した後の読了の記録。 */
  finishedReadings: readonly FinishedReading[];
  /** 英文を読んだ日ごとの、訳を出した回数。 */
  englishReadingDays: EnglishReadingDays;
};

// 判定基準は週あたりの量のため、前の週と比べられる 2 週分を出す
const displayedDayCount = 14;

/**
 * 読了した時に再生の画面の中に出す結果。読んだ時間・量・実効速度と、読了の記録の集計を出す。内容の質問は出さない (ADR 0002)。
 * 記録の表は判定日に確かめるためのもので、読み終えるたびに見るものではないため、開閉できる欄に入れる。
 */
function FinishedSummary({ readerState, finishedReadings, englishReadingDays }: FinishedSummaryProps) {
  const summary = readingSummary(readerState);
  const finishedReadingSummary = summarizeFinishedReadings(finishedReadings, readerState.finishedAt ?? 0);
  const englishReadingDaysSummary = summarizeEnglishReadingDays(englishReadingDays, readerState.finishedAt ?? 0);
  return (
    <section className={styles.finished}>
      <h2 className={styles.title}>読了</h2>
      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dt>読んだ時間</dt>
          <dd>{formatPlayedTime(summary.playedMs)}</dd>
        </div>
        <div className={styles.stat}>
          <dt>読んだ量</dt>
          <dd>{formatReadAmount(summary)}</dd>
        </div>
        {summary.japaneseCharactersPerMinute !== undefined && (
          <div className={styles.stat}>
            <dt>実効速度 (日本語)</dt>
            <dd>{formatNumber(summary.japaneseCharactersPerMinute)} 文字/分</dd>
          </div>
        )}
        {summary.englishWordsPerMinute !== undefined && (
          <div className={styles.stat}>
            <dt>実効速度 (英語)</dt>
            <dd>{formatNumber(summary.englishWordsPerMinute)} 語/分</dd>
          </div>
        )}
      </dl>
      <details className={styles.recordsDetails}>
        <summary className={styles.heading}>これまでの記録</summary>
        <section className={styles.records}>
          <h3 className={styles.heading}>読了の記録</h3>
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
            <h3 className={styles.heading}>英文の訳の表示</h3>
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
      </details>
    </section>
  );
}

/**
 * 再生の画面。単位を 1 つずつ画面中央に中央揃えで出し、停止中だけ全文と現在位置のハイライトを出す。
 * 読了しても別の画面へ切り替えず、最後の単位を出したまま止めて読了の結果を足す。取り込みの画面へ戻るボタンは再生中も出す。
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
  // 画面を閉じたか。言語モデルのダウンロード中に閉じた後で作り終えた翻訳器を、使わずに手放すために持つ
  const isUnmountedRef = useRef(false);
  // 訳している最中の文の添字。同じ文を二重に訳さないために持つ
  const translatingSentenceIndexesRef = useRef(new Set<number>());
  // 英文を読んだ日として保存済みの日付。英語の単位を表示し終えるたびに localStorage を書き直さないために持つ
  const recordedEnglishReadingDateRef = useRef<string>(undefined);
  const languages = useMemo(() => presentLanguages(units), [units]);
  const remainingDurations = useMemo(() => remainingDurationsMs(units, readerState.speed), [units, readerState.speed]);
  const hasEnglishSentence = useMemo(() => containsEnglishSentence(sentences), [sentences]);
  const currentSentenceIndex = units[readerState.unitIndex].sentenceIndex;
  const isTranslationShown = isTranslationDisplayed(translationState, {
    currentSentenceLanguage: sentences[currentSentenceIndex].language,
    finished: readerState.status === "finished",
  });

  // 英文を含む本文では、翻訳器を作れるかを先に確かめ、切り替えボタンを有効にするか・理由を出すかを決める
  useEffect(() => {
    if (!hasEnglishSentence) {
      return;
    }
    void checkTranslatorAvailability().then((availability) =>
      setTranslationState((state) => applyTranslatorAvailability(state, availability)),
    );
  }, [hasEnglishSentence]);

  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      translatorRef.current?.destroy();
      translatorRef.current = undefined;
    };
  }, []);

  // 訳を表示している間は、今の文が英文で訳が無ければ訳す。訳は文ごとに残し、同じ文に戻った時は訳し直さない
  useEffect(() => {
    const translator = translatorRef.current;
    const sentence = sentences[currentSentenceIndex];
    if (
      !isTranslationShown ||
      translator === undefined ||
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
  }, [currentSentenceIndex, isTranslationShown, sentenceTranslations, sentences, source]);

  // 今の文の訳が画面に出る状態に変わるたびに、その日の訳を出した回数を記録する。翻訳器を作れなかった操作と、日本語の文の上で出した操作は数えない
  useEffect(() => {
    if (isTranslationShown) {
      recordTranslationDisplay(Date.now());
    }
  }, [isTranslationShown]);

  /** 訳の表示と非表示を切り替える。翻訳器の作成にユーザー操作が要るため、ボタン・T キーのイベントの中から呼ぶ。 */
  const toggleTranslationDisplay = useCallback(() => {
    const nextTranslationState = toggleTranslation(translationState);
    setTranslationState(nextTranslationState);
    if (startsCreatingTranslator(translationState, nextTranslationState)) {
      createTranslator((loaded) => setTranslationState((state) => applyDownloadProgress(state, loaded))).then(
        (translator) => {
          if (isUnmountedRef.current) {
            translator.destroy();
            return;
          }
          translatorRef.current = translator;
          setTranslationState(applyTranslatorCreated);
        },
        () => setTranslationState(applyTranslatorCreationFailed),
      );
    }
  }, [translationState]);

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
      if (hasEnglishSentence && readerState.status !== "finished" && event.key.toLowerCase() === "t") {
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
  }, [hasEnglishSentence, languages, readerState, toggleTranslationDisplay, translationState]);

  const currentUnit = units[readerState.unitIndex];
  const isPlaying = readerState.status === "playing";
  const isFinished = readerState.status === "finished";
  // 読了は最後の単位を表示し終えた状態のため、最後の単位の分も読んだ位置に含める
  const remaining = isFinished ? 0 : remainingFraction(units, readerState.unitIndex);
  const currentSentenceTranslation = sentenceTranslations[currentSentenceIndex];
  const notice = translatorNotice(translationState);
  return (
    <>
      <AppBar description={isPlaying ? "再生中" : isFinished ? "読了" : "一時停止中"} linksToTop={false} />
      <main className={isPlaying ? `${styles.session} ${styles.playing}` : styles.session}>
        <button
          type="button"
          className={styles.display}
          onMouseDown={keepFocusOffButton}
          onClick={() => setReaderState(togglePlay(readerState, Date.now()))}
          aria-label={isPlaying ? "一時停止" : isFinished ? "最初から読む" : "再開"}
        >
          <span className={stageStyles.stage}>
            <span
              className={
                currentUnit.language === "ja" ? `${stageStyles.unitText} ${stageStyles.japanese}` : stageStyles.unitText
              }
            >
              {currentUnit.text}
            </span>
          </span>
        </button>
        {hasEnglishSentence && (
          // 単位の表示の外 (下) に今の文の訳だけを出す。原文の文と訳を対にして並べない (ADR 0002)
          <p className={styles.translation} lang="ja" aria-live="polite">
            {isTranslationShown &&
              (currentSentenceTranslation === undefined
                ? "訳しています"
                : (currentSentenceTranslation ?? "この文は訳せませんでした"))}
          </p>
        )}
        <div className={styles.controls}>
          <progress className={styles.progressBar} value={1 - remaining} max={1} aria-label="読んだ位置" />
          <div className={styles.controlsRow}>
            <div className={styles.controlsGroup}>
              {languages.map((language) => {
                const speedKey = speedKeys[language];
                const { languageName, speedUnit } = speedLabels[language];
                return (
                  <div key={language} className={styles.controlsGroup}>
                    <button
                      type="button"
                      className={`${buttonStyles.button} ${buttonStyles.quiet}`}
                      onMouseDown={keepFocusOffButton}
                      onClick={() => setReaderState(stepSpeed(readerState, [language], -1))}
                      disabled={readerState.speed[speedKey] <= speedLimits[speedKey].min}
                      aria-label={`遅く (${languageName}の速度を下げる)`}
                    >
                      遅く <kbd>↓</kbd>
                    </button>
                    <span className={styles.readout}>
                      <strong>{formatNumber(readerState.speed[speedKey])}</strong> {speedUnit}
                    </span>
                    <button
                      type="button"
                      className={`${buttonStyles.button} ${buttonStyles.quiet}`}
                      onMouseDown={keepFocusOffButton}
                      onClick={() => setReaderState(stepSpeed(readerState, [language], 1))}
                      disabled={readerState.speed[speedKey] >= speedLimits[speedKey].max}
                      aria-label={`速く (${languageName}の速度を上げる)`}
                    >
                      速く <kbd>↑</kbd>
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              className={`${buttonStyles.button} ${buttonStyles.primary} ${styles.playButton}`}
              onMouseDown={keepFocusOffButton}
              onClick={() => setReaderState(togglePlay(readerState, Date.now()))}
            >
              {isPlaying ? "一時停止" : isFinished ? "最初から読む" : "再生"} <kbd>space</kbd>
            </button>
            <span className={styles.readout}>
              残り {Math.round(remaining * 100)}%
              {!isFinished && ` ・ ${formatRemainingTime(remainingDurations[readerState.unitIndex])}`}
            </span>
          </div>
          <div className={styles.controlsRow}>
            <div className={styles.controlsGroup}>
              <button
                type="button"
                className={buttonStyles.button}
                onMouseDown={keepFocusOffButton}
                onClick={() => setReaderState(moveBySentence(readerState, "previous"))}
              >
                前の文 <kbd>shift ←</kbd>
              </button>
              <button
                type="button"
                className={buttonStyles.button}
                onMouseDown={keepFocusOffButton}
                onClick={() => setReaderState(moveByUnits(readerState, -1))}
              >
                前へ <kbd>←</kbd>
              </button>
              <button
                type="button"
                className={buttonStyles.button}
                onMouseDown={keepFocusOffButton}
                onClick={() => setReaderState(moveByUnits(readerState, 1))}
              >
                次へ <kbd>→</kbd>
              </button>
              <button
                type="button"
                className={buttonStyles.button}
                onMouseDown={keepFocusOffButton}
                onClick={() => setReaderState(moveBySentence(readerState, "next"))}
              >
                次の文 <kbd>shift →</kbd>
              </button>
            </div>
            {hasEnglishSentence && (
              <div className={styles.controlsGroup}>
                <button
                  type="button"
                  className={buttonStyles.button}
                  onMouseDown={keepFocusOffButton}
                  onClick={toggleTranslationDisplay}
                  // 読了後は訳を出さない (T キーも同じ) ため、押せないようにする
                  disabled={isFinished || !canToggleTranslation(translationState)}
                  aria-pressed={translationState.visible}
                >
                  {translationState.visible ? "訳を隠す" : "訳を出す"} <kbd>T</kbd>
                </button>
                {notice !== undefined && <span className={styles.note}>{notice}</span>}
              </div>
            )}
            <button type="button" className={buttonStyles.button} onMouseDown={keepFocusOffButton} onClick={onClose}>
              別の本文を読む
            </button>
          </div>
        </div>
        {isFinished && (
          <FinishedSummary
            readerState={readerState}
            finishedReadings={finishedReadings}
            englishReadingDays={englishReadingDays}
          />
        )}
        {!isPlaying && (
          <section className={styles.fullTextSection}>
            <div className={styles.fullTextHeader}>
              <h2 className={styles.heading}>全文</h2>
              <p className={styles.note}>
                {isFinished ? "クリックした位置から読み直します" : "クリックした位置から再開します"}
              </p>
            </div>
            <FullText
              source={source}
              currentUnit={currentUnit}
              onSelectOffset={(offset) =>
                setReaderState(playFrom(readerState, unitIndexAtOffset(units, offset), Date.now()))
              }
            />
          </section>
        )}
      </main>
    </>
  );
}
