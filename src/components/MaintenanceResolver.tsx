"use client";

import { type ReactNode, useEffect, useState } from "react";
import { AppBar } from "@/components/AppBar";
import { fetchMaintenanceState, type MaintenanceState } from "@/lib/maintenance/maintenance-state";
import buttonStyles from "./Button.module.css";
import styles from "./MaintenanceResolver.module.css";

/**
 * このサービスがメンテナンス中かを返す状態の URL。owner が service-maintenance コマンド (castle の service-maintenance-setup skill) で切り替える。
 * 切り替えの確認に使う検証用のビルドだけ、ビルド時の NEXT_PUBLIC_MAINTENANCE_STATE_URL で手元の状態のサーバーに差し替える。
 * 未設定の時の値は本番の状態の URL (状態を返す Worker の URL + サービス名 sokudoku) で、配信のビルド (deploy.yml) は未設定のままこの値を読む
 */
const maintenanceStateURL =
  process.env.NEXT_PUBLIC_MAINTENANCE_STATE_URL || "https://service-maintenance.star-kojiki.workers.dev/sokudoku";

/** 状態の message が null の時に出す文。このサービスは翻訳の仕組みを持たず画面の文言は日本語だけのため、日本語で書く */
const defaultMaintenanceMessage = "しばらくしてからもう一度開いてください";

/**
 * ページの一番上に置き、ページの読み込み時に状態を 1 回だけ読んで、メンテナンス中ならメンテナンス中の画面だけを出し、
 * children (本来の画面) を作らない。メンテナンス中でない時と状態を読めない時は children を出す。
 * 読み終わるまで (長くても応答を待つ上限の 2 秒) は何も出さない。本来の画面を先に出すと、メンテナンス中の時に一瞬見えて処理も始まるため。
 * タブが前面に戻った時と時間の経過では読み直さないため、開いたままのページは読み込み直すまで切り替わらない
 * (castle の service-maintenance-setup skill の SKILL.md「読む間隔と待つ上限」。owner の決定)
 */
export function MaintenanceResolver({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MaintenanceState | null>(null);
  useEffect(() => {
    // 開発時の StrictMode が effect を 2 回動かした時に、先に破棄された回の結果で画面を決めないため
    let discarded = false;
    void fetchMaintenanceState(maintenanceStateURL).then((read) => {
      if (!discarded) setState(read);
    });
    return () => {
      discarded = true;
    };
  }, []);
  if (state === null) {
    return null;
  }
  return state.maintenance ? <MaintenanceScreen state={state} /> : children;
}

/** メンテナンス中の画面。state の message と button を出し、message が null の時は既定の文を出す */
function MaintenanceScreen({ state }: { state: MaintenanceState }) {
  return (
    <>
      {/* トップページへのリンクは、メンテナンス中は同じこの画面に戻るだけのため出さない */}
      <AppBar linksToTop={false} />
      <main className={styles.page} role="alert">
        <h1 className={styles.title}>メンテナンス中</h1>
        <p className={styles.message}>{state.message ?? defaultMaintenanceMessage}</p>
        {state.button !== null && (
          <a className={buttonStyles.button} href={state.button.url} rel="noopener noreferrer">
            {state.button.label}
          </a>
        )}
      </main>
    </>
  );
}
