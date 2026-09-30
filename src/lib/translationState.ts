/** Translator API の availability() が返す値。 */
export type TranslatorAvailability = "unavailable" | "downloadable" | "downloading" | "available";

/**
 * 英語から日本語への翻訳器の状態。
 * - checking: 使えるかを確かめている
 * - unsupported: ブラウザに Translator API が無い
 * - unavailable / downloadable / downloading / available: availability() の値のまま。翻訳器はまだ作っていない
 * - creating: 翻訳器を作っている。言語モデルのダウンロードが要る時は、ダウンロードの間もこの状態
 * - ready: 翻訳器を作り終えた
 * - failed: 翻訳器を作れなかった。もう一度切り替えると作り直す
 */
export type TranslatorStatus = "checking" | "unsupported" | TranslatorAvailability | "creating" | "ready" | "failed";

/** 英文の訳の出し入れの状態。翻訳器の状態と、訳を表示するかを持つ。 */
export type TranslationState = {
  /** 翻訳器の状態。 */
  translatorStatus: TranslatorStatus;
  /** 言語モデルのダウンロードの進み具合 (0〜1)。creating の間に進み具合を受け取った時だけ値を持つ。 */
  downloadProgress?: number;
  /** 訳を表示するか。 */
  visible: boolean;
};

/** 画面を開いた時の状態。訳は出さず、使えるかを確かめるところから始める。 */
export const initialTranslationState: TranslationState = { translatorStatus: "checking", visible: false };

/** 使えるかを確かめた結果を反映する。availability が undefined なら Translator API が無い。確かめている間だけ反映する。 */
export function applyTranslatorAvailability(
  state: TranslationState,
  availability: TranslatorAvailability | undefined,
): TranslationState {
  if (state.translatorStatus !== "checking") {
    return state;
  }
  return { ...state, translatorStatus: availability ?? "unsupported" };
}

/** 訳の表示を切り替えられるかを返す。使えるかを確かめている間と、使えない環境では切り替えられない。 */
export function canToggleTranslation(state: TranslationState): boolean {
  return !["checking", "unsupported", "unavailable"].includes(state.translatorStatus);
}

/**
 * 訳の表示と非表示を切り替える。翻訳器をまだ作っていなければ、作り始めて (creating) 表示にする。
 * 翻訳器の作成にはユーザー操作が要るため、呼び出し側はボタン・キー操作の中でこの関数を呼び、startsCreatingTranslator が真なら翻訳器を作る。
 */
export function toggleTranslation(state: TranslationState): TranslationState {
  switch (state.translatorStatus) {
    case "checking":
    case "unsupported":
    case "unavailable":
      return state;
    case "downloadable":
    case "downloading":
    case "available":
    case "failed":
      return { translatorStatus: "creating", visible: true };
    case "creating":
    case "ready":
      return { ...state, visible: !state.visible };
  }
}

/** 状態の変化が、翻訳器を作り始める変化かを返す。 */
export function startsCreatingTranslator(previous: TranslationState, next: TranslationState): boolean {
  return previous.translatorStatus !== "creating" && next.translatorStatus === "creating";
}

/** 言語モデルのダウンロードの進み具合 (0〜1) を反映する。翻訳器を作っている間だけ反映する。 */
export function applyDownloadProgress(state: TranslationState, loaded: number): TranslationState {
  if (state.translatorStatus !== "creating") {
    return state;
  }
  return { ...state, downloadProgress: Math.min(Math.max(loaded, 0), 1) };
}

/** 翻訳器を作り終えたことを反映する。表示するかは作っている間の切り替えのまま残す。 */
export function applyTranslatorCreated(state: TranslationState): TranslationState {
  if (state.translatorStatus !== "creating") {
    return state;
  }
  return { translatorStatus: "ready", visible: state.visible };
}

/** 翻訳器を作れなかったことを反映し、訳を隠す。 */
export function applyTranslatorCreationFailed(state: TranslationState): TranslationState {
  if (state.translatorStatus !== "creating") {
    return state;
  }
  return { translatorStatus: "failed", visible: false };
}
