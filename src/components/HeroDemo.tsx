"use client";

import { useEffect, useMemo, useState } from "react";
import { displayDurationMs } from "@/lib/displayDuration";
import { defaultReadingSpeed } from "@/lib/readerState";
import { segmentText } from "@/lib/readingUnits";
import stageStyles from "./UnitStage.module.css";

// 表示の例に流す本文。青空文庫の夏目漱石「吾輩は猫である」の冒頭 (著作権の保護期間が満了している)
const sampleText = "吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。";

// 最後の単位の後、最初に戻る前に足す間。繰り返しの切れ目が分かる長さとして、モックで見た目を確かめた 1.2 秒にする
const loopPauseMs = 1200;

/**
 * トップページの表示の例。リーダー画面と同じ分割と表示時間で、例文を初期値の速度で繰り返し流す。
 * 動きを減らす設定の時は最初の単位で止めておく。
 */
export function HeroDemo() {
  const units = useMemo(() => segmentText(sampleText).units, []);
  const [unitIndex, setUnitIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timeoutId = window.setTimeout(
      () => setUnitIndex((unitIndex + 1) % units.length),
      displayDurationMs(units[unitIndex], defaultReadingSpeed) + (unitIndex === units.length - 1 ? loopPauseMs : 0),
    );
    return () => window.clearTimeout(timeoutId);
  }, [unitIndex, units]);

  return (
    <div className={stageStyles.stage} aria-hidden="true">
      <span className={`${stageStyles.unitText} ${stageStyles.japanese}`}>{units[unitIndex].text}</span>
    </div>
  );
}
