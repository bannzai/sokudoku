"use client";

import { Activity, type ReactNode, useEffect, useState } from "react";
import { AppBar } from "@/components/AppBar";
import { type MaintenanceState, NOT_IN_MAINTENANCE } from "@/lib/maintenance/maintenance-state";
import { watchMaintenanceState } from "@/lib/maintenance/web-maintenance-gate";
import buttonStyles from "./Button.module.css";
import styles from "./MaintenanceGate.module.css";

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
 * 状態を読み続け、メンテナンス中の間は children (通常の画面) を隠してメンテナンス中の画面を出す。
 * children は Activity の hidden で隠し、state (開いた本文・入力中の文) を残したまま effect (再生のタイマー等) を止める。
 * 本文は保存しないため (AGENTS.md の不変条件)、unmount すると通常に戻った時に読んでいた本文を失うため。
 * 状態を読めない時は通常の画面のまま動かす (watchMaintenanceState が「メンテナンス中でない」状態を渡す)
 */
export function MaintenanceGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MaintenanceState>(NOT_IN_MAINTENANCE);
  useEffect(() => watchMaintenanceState({ stateURL: maintenanceStateURL, onState: setState }), []);
  return (
    <>
      <Activity mode={state.maintenance ? "hidden" : "visible"}>{children}</Activity>
      {state.maintenance && <MaintenanceScreen state={state} />}
    </>
  );
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
