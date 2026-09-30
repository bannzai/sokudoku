import { afterEach, describe, expect, it, vi } from "vitest";
import { checkTranslatorAvailability, createTranslator, type EnglishToJapaneseTranslator } from "./translator";

describe("Translator API の薄い層", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Translator API が無ければ、使えるかは undefined で、翻訳器は作れない", async () => {
    vi.stubGlobal("Translator", undefined);
    expect(await checkTranslatorAvailability()).toBeUndefined();
    await expect(createTranslator(() => {})).rejects.toThrow();
  });

  it("英語から日本語への組で使えるかを確かめる", async () => {
    const availability = vi.fn().mockResolvedValue("downloadable");
    vi.stubGlobal("Translator", { availability, create: vi.fn() });
    expect(await checkTranslatorAvailability()).toBe("downloadable");
    expect(availability).toHaveBeenCalledWith({ sourceLanguage: "en", targetLanguage: "ja" });
  });

  it("使えるかを確かめられなければ unavailable にする", async () => {
    vi.stubGlobal("Translator", { availability: vi.fn().mockRejectedValue(new Error("x")), create: vi.fn() });
    expect(await checkTranslatorAvailability()).toBe("unavailable");
  });

  it("英語から日本語への翻訳器を作り、ダウンロードの進み具合を渡す", async () => {
    const translator: EnglishToJapaneseTranslator = { translate: vi.fn(), destroy: vi.fn() };
    const create = vi.fn((options: { monitor: (monitor: EventTarget) => void }) => {
      const monitor = new EventTarget();
      options.monitor(monitor);
      monitor.dispatchEvent(Object.assign(new Event("downloadprogress"), { loaded: 0.25 }));
      monitor.dispatchEvent(Object.assign(new Event("downloadprogress"), { loaded: 1 }));
      return Promise.resolve(translator);
    });
    vi.stubGlobal("Translator", { availability: vi.fn(), create });
    const onDownloadProgress = vi.fn();
    expect(await createTranslator(onDownloadProgress)).toBe(translator);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sourceLanguage: "en", targetLanguage: "ja" }));
    expect(onDownloadProgress.mock.calls).toEqual([[0.25], [1]]);
  });
});
