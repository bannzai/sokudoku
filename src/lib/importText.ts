import { isAozoraBunkoText, stripAozoraBunkoNotation } from "./aozoraBunko";
import { extractEpubText } from "./epub";
import type { ParagraphBoundaries } from "./readingUnits";

/** 本文を取り込めなかった理由。URL からの取り込みの理由 (invalid-url 以降) は network を除き Worker の ExtractError (worker/src/index.ts) と同じ値 */
export type ImportFailureReason =
  | "empty"
  | "drm"
  | "invalid-epub"
  | "too-large"
  | "unsupported-encoding"
  | "unsupported-file"
  | "unreadable-file"
  | "invalid-url"
  | "blocked-url"
  | "robots-disallowed"
  | "page-too-large"
  | "page-unavailable"
  | "unextractable"
  | "rate-limited"
  | "network";

/**
 * 取り込みの結果。成功時の text がリーダー画面へ渡す本文。
 * paragraphBoundaries は URL からの取り込みで Worker が LLM に区切らせた、text の段落ごとの区切りの位置 (区切らせた段落が無ければ undefined)
 */
export type ImportResult =
  | { ok: true; text: string; paragraphBoundaries?: ParagraphBoundaries }
  | { ok: false; reason: ImportFailureReason };

/** 取り込めなかった理由ごとの、利用者に見せる文言 */
export const importFailureMessages: Record<ImportFailureReason, string> = {
  empty: "本文が空です",
  drm: "DRM で保護された EPUB は読み込めません",
  "invalid-epub": "EPUB として読み込めませんでした",
  "too-large": "EPUB の本文が大きすぎて読み込めません",
  "unsupported-encoding": "文字コードを判定できませんでした (UTF-8 と Shift_JIS に対応)",
  "unsupported-file": "txt と EPUB のファイルだけ読み込めます",
  "unreadable-file": "ファイルを読み込めませんでした",
  "invalid-url": "http:// か https:// で始まる URL を入力してください",
  "blocked-url": "この URL のページは読み込めません",
  "robots-disallowed": "このサイトは自動での取得を許可していないため読み込めません",
  "page-too-large": "ページが大きすぎて読み込めません",
  "page-unavailable": "ページを取得できませんでした (ログインが必要なページや有料のページは読めません)",
  unextractable: "このページから本文を取り出せませんでした",
  "rate-limited": "読み込みが続いたため 1 分ほど待ってから試してください",
  network: "取得用のサーバーから応答を受け取れませんでした",
};

// 青空文庫のテキストは Shift_JIS が多く、それ以外のテキストは UTF-8 が大半のため、この 2 つを順に試す
const textEncodings = ["utf-8", "shift_jis"];

/** 改行を LF に揃えて前後の空白を除き、空なら失敗にする */
function finishText(text: string): ImportResult {
  const normalizedText = text.replace(/\r\n?/g, "\n").trim();
  return normalizedText === "" ? { ok: false, reason: "empty" } : { ok: true, text: normalizedText };
}

/** テキストファイルのバイト列を、UTF-8 か Shift_JIS として読む。どちらとしても読めなければ undefined を返す */
export function decodeTextBytes(bytes: Uint8Array): string | undefined {
  for (const encoding of textEncodings) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch {
      // この文字コードとして不正なバイト列のため、次の文字コードを試す
    }
  }
  return undefined;
}

/** 貼り付けた文字列や txt の中身を本文にする。青空文庫の書式なら注記を除く */
export function importPlainText(text: string): ImportResult {
  const finishedText = finishText(text);
  return finishedText.ok && isAozoraBunkoText(finishedText.text)
    ? finishText(stripAozoraBunkoNotation(finishedText.text))
    : finishedText;
}

/** ファイル名の拡張子で txt か EPUB かを決め、ファイルのバイト列から本文を取り出す */
export function importFile(fileName: string, bytes: Uint8Array): ImportResult {
  switch (/\.([^.]+)$/.exec(fileName)?.[1].toLowerCase()) {
    case "txt": {
      const text = decodeTextBytes(bytes);
      return text === undefined ? { ok: false, reason: "unsupported-encoding" } : importPlainText(text);
    }
    case "epub": {
      const epubResult = extractEpubText(bytes);
      return epubResult.ok ? finishText(epubResult.text) : epubResult;
    }
    default:
      return { ok: false, reason: "unsupported-file" };
  }
}
