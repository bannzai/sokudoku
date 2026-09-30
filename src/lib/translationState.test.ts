import { describe, expect, it } from "vitest";
import {
  applyDownloadProgress,
  applyTranslatorAvailability,
  applyTranslatorCreated,
  applyTranslatorCreationFailed,
  canToggleTranslation,
  initialTranslationState,
  startsCreatingTranslator,
  toggleTranslation,
  type TranslationState,
} from "./translationState";

describe("使えるかを確かめた結果", () => {
  it("Translator API が無ければ unsupported にし、切り替えられない", () => {
    const state = applyTranslatorAvailability(initialTranslationState, undefined);
    expect(state).toEqual({ translatorStatus: "unsupported", visible: false });
    expect(canToggleTranslation(state)).toBe(false);
    expect(toggleTranslation(state)).toBe(state);
  });

  it("unavailable なら切り替えられない", () => {
    const state = applyTranslatorAvailability(initialTranslationState, "unavailable");
    expect(state.translatorStatus).toBe("unavailable");
    expect(canToggleTranslation(state)).toBe(false);
    expect(toggleTranslation(state)).toBe(state);
  });

  it("確かめている間は切り替えられない", () => {
    expect(canToggleTranslation(initialTranslationState)).toBe(false);
    expect(toggleTranslation(initialTranslationState)).toBe(initialTranslationState);
  });

  it("downloadable・downloading・available なら切り替えられる", () => {
    for (const availability of ["downloadable", "downloading", "available"] as const) {
      const state = applyTranslatorAvailability(initialTranslationState, availability);
      expect(state.translatorStatus).toBe(availability);
      expect(canToggleTranslation(state)).toBe(true);
    }
  });

  it("確かめ終えた後の結果は反映しない", () => {
    const state: TranslationState = { translatorStatus: "ready", visible: true };
    expect(applyTranslatorAvailability(state, "unavailable")).toBe(state);
  });
});

describe("訳の表示の切り替え", () => {
  it("翻訳器が無ければ作り始めて表示にする", () => {
    for (const availability of ["downloadable", "downloading", "available"] as const) {
      const previous = applyTranslatorAvailability(initialTranslationState, availability);
      const next = toggleTranslation(previous);
      expect(next).toEqual({ translatorStatus: "creating", visible: true });
      expect(startsCreatingTranslator(previous, next)).toBe(true);
    }
  });

  it("作っている間に切り替えると、作り直さずに表示だけを切り替える", () => {
    const creating: TranslationState = { translatorStatus: "creating", downloadProgress: 0.5, visible: true };
    const hidden = toggleTranslation(creating);
    expect(hidden).toEqual({ translatorStatus: "creating", downloadProgress: 0.5, visible: false });
    expect(startsCreatingTranslator(creating, hidden)).toBe(false);
    expect(toggleTranslation(hidden)).toEqual(creating);
  });

  it("作り終えた後は表示と非表示を切り替え、翻訳器を作り直さない", () => {
    const shown: TranslationState = { translatorStatus: "ready", visible: true };
    const hidden = toggleTranslation(shown);
    expect(hidden).toEqual({ translatorStatus: "ready", visible: false });
    expect(toggleTranslation(hidden)).toEqual(shown);
    expect(startsCreatingTranslator(hidden, toggleTranslation(hidden))).toBe(false);
  });

  it("作れなかった後に切り替えると作り直す", () => {
    const failed: TranslationState = { translatorStatus: "failed", visible: false };
    const next = toggleTranslation(failed);
    expect(next).toEqual({ translatorStatus: "creating", visible: true });
    expect(startsCreatingTranslator(failed, next)).toBe(true);
  });
});

describe("翻訳器の作成", () => {
  const creating: TranslationState = { translatorStatus: "creating", visible: true };

  it("ダウンロードの進み具合を 0〜1 に収めて反映する", () => {
    expect(applyDownloadProgress(creating, 0.42)).toEqual({ ...creating, downloadProgress: 0.42 });
    expect(applyDownloadProgress(creating, 1.5).downloadProgress).toBe(1);
    expect(applyDownloadProgress(creating, -1).downloadProgress).toBe(0);
  });

  it("作り終えたら ready にし、進み具合を消して表示の切り替えを残す", () => {
    expect(applyTranslatorCreated({ ...creating, downloadProgress: 1 })).toEqual({
      translatorStatus: "ready",
      visible: true,
    });
    expect(applyTranslatorCreated({ ...creating, visible: false })).toEqual({ translatorStatus: "ready", visible: false });
  });

  it("作れなかったら failed にして訳を隠す", () => {
    expect(applyTranslatorCreationFailed(creating)).toEqual({ translatorStatus: "failed", visible: false });
  });

  it("作っている間でなければ、進み具合・作成の結果を反映しない", () => {
    const ready: TranslationState = { translatorStatus: "ready", visible: false };
    expect(applyDownloadProgress(ready, 0.5)).toBe(ready);
    expect(applyTranslatorCreated(ready)).toBe(ready);
    expect(applyTranslatorCreationFailed(ready)).toBe(ready);
  });
});
