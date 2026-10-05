import { type ImportFailureReason, type ImportResult, importPlainText } from "./importText";
import { isParagraphBoundaries, type ParagraphBoundaries, paragraphMatches } from "./readingUnits";

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

// Worker の呼び出しの時間の上限。Worker 自身の取得の上限 (10 秒、worker/src/index.ts) と LLM に区切らせる時間の上限
// (10 秒、worker/src/segment.ts) に、ブラウザと Worker の間の通信の余裕を足した値
const extractTimeoutMilliseconds = 30_000;

/**
 * 入力された URL を、URL から本文を取り出す Worker (extractEndpoint は Worker のオリジン。NEXT_PUBLIC_EXTRACT_URL) に渡し、
 * 返ってきた本文を貼り付けと同じ経路で取り込む。title は本文の先頭の段落にする。Worker が LLM に区切らせた段落の区切りの位置は paragraphBoundaries に添える。
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
  // 認証情報付きの URL は Worker も取得しない (blocked-url) ため、パスワードを Worker へ送る前にここで止める
  if (pageUrl.username !== "" || pageUrl.password !== "") {
    return { ok: false, reason: "blocked-url" };
  }
  // ページ内の位置 (#...) は取得に使わないため、Worker へ送る URL から除く
  pageUrl.hash = "";
  // 通信が止まっても「取得中」のまま戻れなくならないよう、レスポンスの本文を読み終えるまでに時間の上限を置く
  const signal = AbortSignal.timeout(extractTimeoutMilliseconds);
  let response: Response;
  try {
    // extractEndpoint が URL として不正な配信の設定の誤りも、Worker に届かない失敗として扱う
    const requestUrl = new URL("/extract", extractEndpoint);
    requestUrl.searchParams.set("url", pageUrl.href);
    response = await fetchExtract(requestUrl, { cache: "no-store", credentials: "omit", signal });
  } catch {
    return { ok: false, reason: "network" };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (signal.aborted) {
      return { ok: false, reason: "network" };
    }
    body = undefined;
  }
  if (!response.ok) {
    return { ok: false, reason: extractFailureReason(response.status, body) };
  }
  if (!isExtractedArticle(body)) {
    return { ok: false, reason: "unextractable" };
  }
  const title = body.title.trim();
  // Readability は記事の見出しを本文に残すことがあり、タイトル (<title>) は見出しにサイト名を足した形 (「見出し - サイト名」) が多い。
  // 本文の先頭の段落がタイトルの先頭と同じなら、見出しを 2 回読ませないようタイトルを重ねない
  const firstParagraph = body.text.trimStart().split("\n", 1)[0].trim();
  const titleRepeatsFirstParagraph = firstParagraph !== "" && title.startsWith(firstParagraph);
  const importResult = importPlainText(title === "" || titleRepeatsFirstParagraph ? body.text : `${title}\n\n${body.text}`);
  if (!importResult.ok) {
    return importResult;
  }
  const paragraphBoundaries = alignParagraphBoundaries(importResult.text, body.text, body.units);
  return paragraphBoundaries === undefined ? importResult : { ...importResult, paragraphBoundaries };
}

/**
 * Worker が本文 (workerText を空行で区切った段落の順) に付けた区切りの位置 (units) を、取り込んだ本文 (importedText) の段落の順に並べ直す。
 * タイトルを先頭に足す・前後の空白を除くなどで段落の位置が変わるため、段落の文字列が一致するものに対応させ、一致しない段落は null (BudouX で分ける) にする。
 * units が無い・形が違う・段落の数が合わない・区切りのある段落が 1 つも無い時は undefined を返す
 */
function alignParagraphBoundaries(
  importedText: string,
  workerText: string,
  units: unknown,
): ParagraphBoundaries | undefined {
  const workerParagraphs = workerText.split("\n\n");
  if (!isParagraphBoundaries(units) || units.length !== workerParagraphs.length) {
    return undefined;
  }
  const boundariesByParagraph = new Map(workerParagraphs.map((paragraph, index) => [paragraph, units[index]]));
  const paragraphBoundaries = paragraphMatches(importedText).map(
    (paragraph) => boundariesByParagraph.get(paragraph[0]) ?? null,
  );
  return paragraphBoundaries.some((boundaries) => boundaries !== null) ? paragraphBoundaries : undefined;
}

/** Worker の失敗のレスポンスの status と { error } から、利用者に見せる理由を決める */
function extractFailureReason(status: number, body: unknown): ImportFailureReason {
  const error = typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
  if (typeof error === "string" && extractErrors.has(error as ImportFailureReason)) {
    return error as ImportFailureReason;
  }
  // Cloudflare が Worker の手前で返した 429 など、{ error } の無い失敗も status から読める範囲で区別する。
  // それ以外 (Worker の設定の誤りで返る forbidden-origin・not-found 等を含む) は、ページではなく取得用のサーバー側の失敗として出す
  return status === 429 ? "rate-limited" : "network";
}

/** Worker の成功のレスポンス ({ title, text, units, siteName?, lang? }) の形をしているかを返す。units の形は alignParagraphBoundaries で確かめる */
function isExtractedArticle(body: unknown): body is { title: string; text: string; units?: unknown } {
  return (
    typeof body === "object" &&
    body !== null &&
    "title" in body &&
    typeof body.title === "string" &&
    "text" in body &&
    typeof body.text === "string"
  );
}
