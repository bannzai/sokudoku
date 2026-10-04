import { type ImportFailureReason, type ImportResult, importPlainText } from "./importText";

// Worker (worker/src/index.ts) が { error } で返す理由のうち、利用者に見せる文言があるもの
const extractErrors = new Set<ImportFailureReason>([
  "invalid-url",
  "blocked-url",
  "robots-disallowed",
  "page-too-large",
  "page-unavailable",
  "unextractable",
  "rate-limited",
]);

/**
 * 入力された URL を、URL から本文を取り出す Worker (extractEndpoint は Worker のオリジン。NEXT_PUBLIC_EXTRACT_URL) に渡し、
 * 返ってきた本文を貼り付けと同じ経路で取り込む。title は本文の先頭の段落にする。
 * Worker に送るのはページの URL だけで、本文も読書位置も送らない。fetchExtract は Worker の呼び出しに使う (test で差し替える)
 */
export async function importFromUrl(
  pageUrlInput: string,
  extractEndpoint: string,
  fetchExtract: typeof fetch = fetch,
): Promise<ImportResult> {
  let pageUrl: URL;
  try {
    pageUrl = new URL(pageUrlInput.trim());
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:") {
    return { ok: false, reason: "invalid-url" };
  }
  let response: Response;
  try {
    // extractEndpoint が URL として不正な配信の設定の誤りも、Worker に届かない失敗として扱う
    const requestUrl = new URL("/extract", extractEndpoint);
    requestUrl.searchParams.set("url", pageUrl.href);
    response = await fetchExtract(requestUrl, { cache: "no-store", credentials: "omit" });
  } catch {
    return { ok: false, reason: "network" };
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    return { ok: false, reason: extractFailureReason(response.status, body) };
  }
  if (!isExtractedArticle(body)) {
    return { ok: false, reason: "unextractable" };
  }
  const title = body.title.trim();
  // Readability は記事の見出しを本文に残すことがあるため、本文の先頭の段落がタイトルと同じなら重ねない
  const firstParagraph = body.text.trimStart().split("\n", 1)[0].trim();
  return importPlainText(title === "" || firstParagraph === title ? body.text : `${title}\n\n${body.text}`);
}

/** Worker の失敗のレスポンスの status と { error } から、利用者に見せる理由を決める */
function extractFailureReason(status: number, body: unknown): ImportFailureReason {
  const error = typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
  if (typeof error === "string" && extractErrors.has(error as ImportFailureReason)) {
    return error as ImportFailureReason;
  }
  // Cloudflare が Worker の手前で返した 429 など、{ error } の無い失敗も status から読める範囲で区別する
  return status === 429 ? "rate-limited" : "page-unavailable";
}

/** Worker の成功のレスポンス ({ title, text, siteName?, lang? }) の形をしているかを返す */
function isExtractedArticle(body: unknown): body is { title: string; text: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    "title" in body &&
    typeof body.title === "string" &&
    "text" in body &&
    typeof body.text === "string"
  );
}
