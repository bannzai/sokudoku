"use client";

import Link from "next/link";
import { useState } from "react";
import { AppBar } from "@/components/AppBar";
import { TextImporter } from "@/components/TextImporter";
import type { ReadingSpeed } from "@/lib/displayDuration";
import { defaultReadingSpeed } from "@/lib/readerState";
import { hashText, loadReadingPosition, loadReadingSpeed, type ReadingPosition } from "@/lib/readerStorage";
import { type SegmentedText, segmentText } from "@/lib/readingUnits";
import { ReadingSession } from "./ReadingSession";
import styles from "./Reader.module.css";

/** 開いた本文と、再生を始める時の位置・速度。 */
type OpenedText = {
  /** 取り込んだ本文。ブラウザのメモリにだけ置き、保存も送信もしない。 */
  source: string;
  /** 本文を分割した結果。 */
  segmentedText: SegmentedText;
  /** 本文のハッシュ。読書位置の保存のキーにする。 */
  textHash: string;
  /** 前回の続きの位置と、そこまでの再生時間・読んだ量。保存が無ければ undefined で、先頭から読む。 */
  resumedPosition?: ReadingPosition;
  /** 保存した速度。保存が無ければ初期値。 */
  speed: ReadingSpeed;
};

/** リーダー画面。本文を取り込むまでは取り込み部品を出し、取り込んだら再生の画面に切り替える。 */
export function Reader() {
  const [openedText, setOpenedText] = useState<OpenedText>();

  /** 取り込んだ本文を分割し、保存した速度と前回の位置を読んで再生の画面を開く。 */
  async function openText(source: string) {
    const segmentedText = segmentText(source);
    const textHash = await hashText(source);
    setOpenedText({
      source,
      segmentedText,
      textHash,
      resumedPosition: loadReadingPosition(textHash, segmentedText.units.length),
      speed: loadReadingSpeed() ?? defaultReadingSpeed,
    });
  }

  if (openedText === undefined) {
    return (
      <>
        <AppBar />
        <main className={styles.importPage}>
          <h1 className={styles.title}>読む本文を選ぶ</h1>
          <TextImporter onImport={(source) => void openText(source)} />
          <nav className={styles.legalLinks}>
            <Link href="/about/">このサービスについて</Link>
            <Link href="/terms/">利用規約</Link>
            <Link href="/privacy/">プライバシーポリシー</Link>
          </nav>
        </main>
      </>
    );
  }
  return (
    <ReadingSession
      key={openedText.textHash}
      source={openedText.source}
      units={openedText.segmentedText.units}
      sentences={openedText.segmentedText.sentences}
      textHash={openedText.textHash}
      resumedPosition={openedText.resumedPosition}
      initialSpeed={openedText.speed}
      onClose={() => setOpenedText(undefined)}
    />
  );
}
