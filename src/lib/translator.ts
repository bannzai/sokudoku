import type { TranslatorAvailability } from "./translationState";

/** 英語から日本語への翻訳器。Chrome の Translator API が端末内で翻訳し、文を外部へ送らない。 */
export type EnglishToJapaneseTranslator = {
  /** 文を日本語に訳す。 */
  translate(text: string): Promise<string>;
  /** 翻訳器が持つ資源を手放す。 */
  destroy(): void;
};

/** 翻訳の元と先の言語。 */
type TranslatorLanguages = {
  /** 元の言語 (BCP 47)。 */
  sourceLanguage: string;
  /** 訳す先の言語 (BCP 47)。 */
  targetLanguage: string;
};

/** Chrome の Translator API のうち、この画面で使う部分。TypeScript の lib.dom に定義が無いため書く。 */
type TranslatorApi = {
  /** 言語の組を翻訳できるかを返す。ユーザー操作は要らない。 */
  availability(options: TranslatorLanguages): Promise<TranslatorAvailability>;
  /** 翻訳器を作る。言語モデルのダウンロードが要る時はユーザー操作の中で呼ぶ。monitor で進み具合を受け取る。 */
  create(
    options: TranslatorLanguages & { monitor?: (monitor: EventTarget) => void },
  ): Promise<EnglishToJapaneseTranslator>;
};

const englishToJapanese: TranslatorLanguages = { sourceLanguage: "en", targetLanguage: "ja" };

/** ブラウザの Translator API を返す。デスクトップの Chrome 138 より前・他のブラウザ・モバイルでは undefined。 */
function translatorApi(): TranslatorApi | undefined {
  return (globalThis as { Translator?: TranslatorApi }).Translator;
}

/** 英語から日本語へ翻訳できるかを返す。Translator API が無ければ undefined、確かめられなければ unavailable を返す。 */
export async function checkTranslatorAvailability(): Promise<TranslatorAvailability | undefined> {
  const api = translatorApi();
  if (api === undefined) {
    return undefined;
  }
  try {
    return await api.availability(englishToJapanese);
  } catch {
    return "unavailable";
  }
}

/**
 * 英語から日本語への翻訳器を作る。ユーザー操作を要するため、ボタン・キー操作のイベントの中から呼ぶ
 * (この関数は await を挟まずに Translator.create を呼ぶ)。言語モデルのダウンロードの進み具合 (0〜1) を onDownloadProgress に渡す。
 */
export function createTranslator(onDownloadProgress: (loaded: number) => void): Promise<EnglishToJapaneseTranslator> {
  const api = translatorApi();
  if (api === undefined) {
    return Promise.reject(new Error("Translator API がありません"));
  }
  return api.create({
    ...englishToJapanese,
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => onDownloadProgress((event as ProgressEvent).loaded));
    },
  });
}
