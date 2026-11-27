import { fetchMaintenanceState, type MaintenanceFetchOptions, type MaintenanceState } from "./maintenance-state";

/**
 * クライアントが状態を読み直す間隔の既定 (ミリ秒)。
 * 切り替えてから開いたままの画面が変わるまでの遅れを、deploy の反映の遅れに 60 秒を足した時間までにする
 * (service-maintenance-setup skill の SKILL.md「読む間隔と待つ上限」)
 */
export const DEFAULT_CLIENT_POLL_INTERVAL_MS = 60_000;

/** 状態を読み続ける時の設定 */
export type MaintenanceWatchOptions = MaintenanceFetchOptions & {
  /** `<状態を返す Worker の URL>/<サービス名>` */
  stateURL: string;
  /** 読むたびに、読んだ状態 (読めなかった時は NOT_IN_MAINTENANCE) を受け取る */
  onState: (state: MaintenanceState) => void;
  /** 読み直す間隔 (ミリ秒) */
  pollIntervalMs?: number;
  /** 前面に戻ったことを知るための document。テストで差し替える */
  document?: Document;
};

/**
 * 起動時 (呼んだ時)・タブが前面に戻った時・前面にいる間の pollIntervalMs ごとに状態を読み、onState に渡す。
 * 返す関数を呼ぶと読むのをやめる。React では useEffect の中で呼び、返す関数を後始末に渡す
 */
export function watchMaintenanceState(options: MaintenanceWatchOptions): () => void {
  const watchedDocument = options.document ?? document;
  let stopped = false;
  let latestReadNumber = 0;
  /** 状態を読み、止めておらず最後に始めた読み取りである時だけ onState に渡す */
  const read = () => {
    const readNumber = ++latestReadNumber;
    void fetchMaintenanceState(options.stateURL, options).then((state) => {
      // 後から始めた読み取りが先に返った時に、古い読み取りの結果で画面を戻さない
      if (!stopped && readNumber === latestReadNumber) options.onState(state);
    });
  };
  /**
   * タブが前面にある時だけ read を呼ぶ。背面のタブでは読まない
   * (読む回数の見積もりは前面にいた分数で数えている。SKILL.md「読む回数と費用の見積もり」)
   */
  const readWhenVisible = () => {
    if (watchedDocument.visibilityState === "visible") read();
  };
  watchedDocument.addEventListener("visibilitychange", readWhenVisible);
  const timer = setInterval(readWhenVisible, options.pollIntervalMs ?? DEFAULT_CLIENT_POLL_INTERVAL_MS);
  read();
  return () => {
    stopped = true;
    clearInterval(timer);
    watchedDocument.removeEventListener("visibilitychange", readWhenVisible);
  };
}

/** メンテナンス中の画面を出す時の設定 */
export type MaintenanceGateOptions = Omit<MaintenanceWatchOptions, "onState"> & {
  /** 状態の message が null の時に出す、このサービスの既定の文 */
  defaultMessage: string;
};

/** メンテナンス中の画面 (通常の画面の上を覆う要素) を作る。state.button が null の時はボタンを入れない */
export function createMaintenanceScreen(ownerDocument: Document, state: MaintenanceState, defaultMessage: string): HTMLElement {
  const screen = ownerDocument.createElement("div");
  screen.setAttribute("role", "alertdialog");
  screen.setAttribute("aria-modal", "true");
  screen.setAttribute("data-maintenance-screen", "");
  // z-index はブラウザが受け付ける最大値 (32 bit の符号付き整数の最大) にし、ページのどの要素より前に出す。
  // 余白 (24px) と色は組み込むプロダクトのデザインに合わせて直す前提の仮の値で、24px は Flutter の雛形の余白とそろえた。
  // 白地に黒文字は、どのプロダクトの画面の上に出しても読める組み合わせ (SKILL.md の Phase 2)
  screen.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:24px;background:#fff;color:#111;text-align:center";
  const message = ownerDocument.createElement("p");
  message.textContent = state.message ?? defaultMessage;
  screen.append(message);
  if (state.button !== null) {
    const button = ownerDocument.createElement("a");
    button.textContent = state.button.label;
    button.setAttribute("href", state.button.url);
    button.setAttribute("rel", "noopener noreferrer");
    // 画面の文と同じ配色を反転した仮の値 (組み込むプロダクトのデザインに合わせて直す前提)。
    // 余白 12px・24px は画面の余白 24px の半分と同じ、角の丸み 8px はその 3 分の 1 で、余白とそろえた比率にした
    button.style.cssText = "padding:12px 24px;border-radius:8px;background:#111;color:#fff;text-decoration:none";
    screen.append(button);
  }
  return screen;
}

/**
 * 状態を読み続け、メンテナンス中の間だけ、通常の画面を覆うメンテナンス中の画面を document.body に出す。
 * 出している間は、body の直下にある通常の画面の要素を inert にして、キーボードと支援技術からも操作できなくする。
 * 返す関数を呼ぶと読むのをやめ、出ている画面を消して通常の画面を操作できる状態に戻す。
 * フレームワークを使わないページと、アプリの一番外側で 1 回呼ぶ使い方を想定する
 */
export function mountMaintenanceGate(options: MaintenanceGateOptions): () => void {
  const ownerDocument = options.document ?? document;
  let screen: HTMLElement | null = null;
  // この関数が inert にした要素。元から inert だった要素は戻す対象に入れない
  let inertedElements: Element[] = [];
  // 出している画面の元になった状態。同じ状態を読み直した時に画面を作り直さない (ボタンのフォーカスを外さないため)
  let shownStateJSON: string | null = null;
  /** 出しているメンテナンス中の画面を消し、この関数が inert にした要素を操作できる状態に戻す */
  const hide = () => {
    screen?.remove();
    screen = null;
    shownStateJSON = null;
    for (const element of inertedElements) element.removeAttribute("inert");
    inertedElements = [];
  };
  const stopWatching = watchMaintenanceState({
    ...options,
    onState: (state) => {
      if (state.maintenance && JSON.stringify(state) === shownStateJSON) return;
      hide();
      if (!state.maintenance) return;
      inertedElements = Array.from(ownerDocument.body.children).filter((element) => !element.hasAttribute("inert"));
      for (const element of inertedElements) element.setAttribute("inert", "");
      screen = createMaintenanceScreen(ownerDocument, state, options.defaultMessage);
      shownStateJSON = JSON.stringify(state);
      ownerDocument.body.append(screen);
    },
  });
  return () => {
    stopWatching();
    hide();
  };
}
