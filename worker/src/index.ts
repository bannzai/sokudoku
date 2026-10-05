import { extractArticle } from "./extract";
import { isAllowedByRobots } from "./robots";
import { type Ai, segmentationTargets, segmentParagraphs } from "./segment";
import { checkTargetUrl } from "./targetUrl";

/** Workers の Rate Limiting binding のうち、この Worker が使う API */
type RateLimit = { limit(options: { key: string }): Promise<{ success: boolean }> };

/** wrangler.toml で Worker に結び付ける binding */
export type Env = {
  /** 同じ IP からの取り込みの回数の制限 */
  EXTRACT_RATE_LIMITER: RateLimit;
  /** 同じ IP から Workers AI に区切らせる記事の回数の制限 */
  SEGMENT_RATE_LIMITER: RateLimit;
  /** 全体で Workers AI に区切らせる記事の回数の制限 */
  SEGMENT_GLOBAL_RATE_LIMITER: RateLimit;
  /** 本文の段落を区切らせる Workers AI */
  AI: Ai;
};

/**
 * 失敗の理由。フロント (src/lib/importText.ts の ImportFailureReason) がこの値で利用者に見せる文言を選ぶ。
 * forbidden-origin・not-found・method-not-allowed はフロントからの正しい呼び出しでは起きない
 */
export type ExtractError =
  | "invalid-url"
  | "blocked-url"
  | "robots-disallowed"
  | "page-too-large"
  | "page-unavailable"
  | "unextractable"
  | "rate-limited"
  | "forbidden-origin"
  | "not-found"
  | "method-not-allowed";

// 本文を呼び出してよいフロントのオリジン。公開サイト (GitHub Pages) と、make dev の dev サーバ (webtunnel は 127.0.0.1 で開く)
const allowedOrigins = new Set(["https://bannzai.github.io", "http://localhost:3000", "http://127.0.0.1:3000"]);

// 取得先のサイトの管理者が取得元を確かめられるよう、製品名と説明のページを名乗る
const userAgent = "sokudoku-extract/1.0 (+https://bannzai.github.io/sokudoku/)";
// robots.txt の User-agent 行と照らし合わせる製品名 (RFC 9309 は大文字小文字を区別しない)
const robotsUserAgentToken = "sokudoku-extract";

// リダイレクトは 5 回まで追う。RFC 9309 が robots.txt に求める回数と同じで、通常のサイトの http → https → 正規の URL の転送に足りる
const maxRedirects = 5;
// ページの HTML の上限。文章のページの HTML は数百 KB に収まり、5 MB を超えるのは本文以外 (埋め込みの画像・スクリプト) が大半を占めるページのため
const maxPageBytes = 5 * 1024 * 1024;
// robots.txt の上限。RFC 9309 がクローラーに読むことを求める最小の大きさ (500 KiB)
const maxRobotsBytes = 500 * 1024;
// 1 回の取り込み (robots.txt とページの取得) の時間の上限。フロントの利用者が待てる時間として 10 秒にする
const timeoutMilliseconds = 10_000;

/** 失敗の理由ごとの HTTP status */
const errorStatuses: Record<ExtractError, number> = {
  "invalid-url": 400,
  "blocked-url": 400,
  "robots-disallowed": 403,
  "page-too-large": 413,
  "page-unavailable": 502,
  unextractable: 422,
  "rate-limited": 429,
  "forbidden-origin": 403,
  "not-found": 404,
  "method-not-allowed": 405,
};

/** 取得の途中で失敗した理由を運ぶ例外 */
class ExtractFailure extends Error {
  /** @param extractError 利用者に返す失敗の理由 */
  constructor(readonly extractError: ExtractError) {
    super(extractError);
  }
}

/** Workers が呼ぶ入口。取得には Workers の fetch を使う */
const worker = {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env, fetch);
  },
};

export default worker;

/**
 * GET /extract?url=<URL> を受け、公開ページの本文を JSON ({ title, text, units, siteName?, lang? }) で返す。失敗は { error } と 4xx・5xx で返す。
 * units は text を空行で区切った段落ごとの、Workers AI に区切らせた位置 (ParagraphBoundaries。documents/adr/0005-llm-segmentation-for-url-import.md)。
 * 取得した URL・本文・LLM の応答はログ・キャッシュ・保存のどこにも残さない。fetchPage はページと robots.txt の取得に使う (test で差し替える)
 */
export async function handleRequest(request: Request, env: Env, fetchPage: typeof fetch): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (origin !== null && !allowedOrigins.has(origin)) {
    return errorResponse("forbidden-origin", null);
  }
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname !== "/extract") {
    return errorResponse("not-found", origin);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders(origin) });
  }
  if (request.method !== "GET") {
    return errorResponse("method-not-allowed", origin);
  }
  // 回数を数えるためだけに IP を使い、記録はしない
  const rateLimitKey = rateLimitKeyForIp(request.headers.get("CF-Connecting-IP"));
  const { success } = await env.EXTRACT_RATE_LIMITER.limit({ key: rateLimitKey });
  if (!success) {
    return errorResponse("rate-limited", origin);
  }
  const targetUrlCheck = checkTargetUrl(requestUrl.searchParams.get("url") ?? "");
  if (!targetUrlCheck.ok) {
    return errorResponse(targetUrlCheck.error, origin);
  }
  try {
    const signal = AbortSignal.timeout(timeoutMilliseconds);
    const page = await fetchPageAllowedByRobots(targetUrlCheck.url, fetchPage, signal);
    let article: ReturnType<typeof extractArticle>;
    try {
      article = extractArticle(page);
    } catch {
      // 極端に深い入れ子の HTML などで解析が例外になったページも、取得はできたが本文を取り出せなかったものとして扱う
      article = undefined;
    }
    if (!article) {
      return errorResponse("unextractable", origin);
    }
    const paragraphs = article.text.split("\n\n");
    // 区切らせる段落が無い記事 (英語だけ等) は回数を数えない。区切らせる記事の回数の上限を超えたら、
    // 本文の取り込みは失敗にせず、全段落を null (フロントが BudouX で分ける) にする
    const units = segmentationTargets(paragraphs).some(Boolean) && (await canSegment(env, rateLimitKey))
      ? await segmentParagraphs(env.AI, paragraphs)
      : paragraphs.map(() => null);
    return new Response(JSON.stringify({ ...article, units }), { status: 200, headers: responseHeaders(origin) });
  } catch (error) {
    // タイムアウト・接続の失敗は、利用者から見るとページを取得できなかったことと同じため page-unavailable にまとめる
    return errorResponse(error instanceof ExtractFailure ? error.extractError : "page-unavailable", origin);
  }
}

/**
 * 記事を Workers AI に区切らせてよいかを、同じ IP (rateLimitKey) の回数と全体の回数の両方の上限から返す。
 * Rate Limiting binding が失敗した時も、本文の取り込みを失敗にしないため false (区切らせない) を返す
 */
async function canSegment(env: Env, rateLimitKey: string): Promise<boolean> {
  try {
    return (
      (await env.SEGMENT_RATE_LIMITER.limit({ key: rateLimitKey })).success &&
      // 全体の回数は 1 つの key で数える。IP を変えて回数の制限をすり抜ける呼び出しでも、Workers AI の回数・費用をこの上限で抑える
      (await env.SEGMENT_GLOBAL_RATE_LIMITER.limit({ key: "global" })).success
    );
  } catch {
    return false;
  }
}

/**
 * 回数の制限に使う key を返す。IPv4 はアドレスのまま、IPv6 は上位 64 bit (/64) にまとめる。
 * IPv6 の利用者は /64 をまとめて割り当てられ、下位 64 bit を変えるだけで別の key になり回数の制限をすり抜けられるため。
 * IP が無い・IPv6 として読めない時はそのまま (無ければ "unknown") 返す
 */
export function rateLimitKeyForIp(ip: string | null): string {
  if (ip === null) {
    return "unknown";
  }
  // IPv4 と、IPv4 を埋め込んだ IPv6 (::ffff:192.0.2.1) は、アドレスのまま数える
  if (!ip.includes(":") || ip.includes(".")) {
    return ip;
  }
  const [head, tail] = ip.split("::");
  const headGroups = head === "" ? [] : head.split(":");
  const tailGroups = tail === undefined || tail === "" ? [] : tail.split(":");
  const groups =
    tail === undefined
      ? headGroups
      : [...headGroups, ...Array<string>(8 - headGroups.length - tailGroups.length).fill("0"), ...tailGroups];
  if (groups.length !== 8 || !groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) {
    return ip;
  }
  return `${groups
    .slice(0, 4)
    .map((group) => parseInt(group, 16).toString(16))
    .join(":")}::/64`;
}

/**
 * リダイレクトを 1 回ずつ検査しながら url のページを取得し、HTML の文字列を返す。
 * 転送先も含め、取得するすべての URL について取得先の検査と robots.txt の確認を行う。失敗は ExtractFailure を投げる
 */
async function fetchPageAllowedByRobots(url: URL, fetchPage: typeof fetch, signal: AbortSignal): Promise<string> {
  // 同じオリジンへの転送でも転送先のパスで判定し直すため、オリジンごとに robots.txt の本文 (無ければ "") を持ち回る
  const robotsTextByOrigin = new Map<string, string>();
  const response = await fetchFollowingRedirects(url, fetchPage, signal, async (hopUrl) => {
    let robotsText = robotsTextByOrigin.get(hopUrl.origin);
    if (robotsText === undefined) {
      robotsText = await fetchRobotsText(hopUrl, fetchPage, signal);
      robotsTextByOrigin.set(hopUrl.origin, robotsText);
    }
    if (!isAllowedByRobots(robotsText, robotsUserAgentToken, `${hopUrl.pathname}${hopUrl.search}`)) {
      throw new ExtractFailure("robots-disallowed");
    }
  });
  if (!response.ok) {
    throw new ExtractFailure("page-unavailable");
  }
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!/^\s*(text\/html|application\/xhtml\+xml)\b/i.test(contentType)) {
    throw new ExtractFailure("unextractable");
  }
  const bytes = await readBodyWithLimit(response, maxPageBytes);
  if (!bytes) {
    throw new ExtractFailure("page-too-large");
  }
  return decodeHtml(bytes, contentType);
}

/**
 * hopUrl のオリジンの robots.txt の本文を返す。RFC 9309 に従い、robots.txt が 4xx なら制限なしとして空文字を返し、
 * 5xx・接続の失敗なら取得しないため ExtractFailure を投げる
 */
async function fetchRobotsText(hopUrl: URL, fetchPage: typeof fetch, signal: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetchFollowingRedirects(new URL("/robots.txt", hopUrl), fetchPage, signal, async () => {});
  } catch (error) {
    if (error instanceof ExtractFailure) {
      throw error;
    }
    throw new ExtractFailure("page-unavailable");
  }
  if (response.status >= 400 && response.status < 500) {
    await response.body?.cancel();
    return "";
  }
  if (!response.ok) {
    throw new ExtractFailure("page-unavailable");
  }
  const bytes = await readBodyWithLimit(response, maxRobotsBytes);
  // 上限を超えた robots.txt は途中までの規則で判定すると許可を誤るおそれがあるため、取得しない側に倒す
  if (!bytes) {
    throw new ExtractFailure("robots-disallowed");
  }
  return new TextDecoder().decode(bytes);
}

/**
 * リダイレクトを自分で追いながら url を GET し、3xx でない最初のレスポンスを返す。
 * 各回の URL を取得先として検査し (転送先の内部アドレスを拒否する)、beforeFetch を取得の前に呼ぶ。
 * キャッシュを使わず (cache: no-store)、Cookie・認証情報を送らない
 */
async function fetchFollowingRedirects(
  url: URL,
  fetchPage: typeof fetch,
  signal: AbortSignal,
  beforeFetch: (hopUrl: URL) => Promise<void>,
): Promise<Response> {
  let hopUrl = url;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    await beforeFetch(hopUrl);
    const response = await fetchPage(hopUrl.toString(), {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal,
      headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
    });
    const location = response.headers.get("Location");
    if (response.status < 300 || response.status >= 400 || location === null) {
      return response;
    }
    // 転送元の本文は読まないため、接続を早く手放す
    await response.body?.cancel();
    const nextUrlCheck = checkTargetUrl(new URL(location, hopUrl).toString());
    if (!nextUrlCheck.ok) {
      throw new ExtractFailure(nextUrlCheck.error);
    }
    hopUrl = nextUrlCheck.url;
  }
  throw new ExtractFailure("page-unavailable");
}

/** レスポンスの本文を maxBytes まで読む。maxBytes を超えたら読むのをやめて undefined を返す */
async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Uint8Array | undefined> {
  const contentLength = Number(response.headers.get("Content-Length"));
  if (contentLength > maxBytes) {
    await response.body?.cancel();
    return undefined;
  }
  if (!response.body) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * HTML のバイト列を文字列にする。文字コードは Content-Type の charset、無ければ先頭 4 KB の meta の charset で決め、
 * どちらも無い・未対応の名前なら UTF-8 で読む (日本語のサイトに残る Shift_JIS・EUC-JP のページを読むため)
 */
export function decodeHtml(bytes: Uint8Array, contentType: string): string {
  // meta を探す範囲は、HTML の仕様が prescan に使う先頭 1024 バイトに、head の前に長いコメント等を置くページの分の余裕をみた 4 KB。
  // 宣言が無いページの既定は、現在の Web のページの大半を占める UTF-8 にする
  const charset =
    charsetParameter(contentType) ??
    metaTags(new TextDecoder().decode(bytes.subarray(0, 4096)))
      .map(charsetParameter)
      .find((metaCharset) => metaCharset !== undefined) ??
    "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/** Content-Type や meta 要素の文字列から charset の値を取り出す。無ければ undefined を返す */
function charsetParameter(text: string): string | undefined {
  return /charset\s*=\s*["']?([\w.:-]+)/i.exec(text)?.[1];
}

/**
 * HTML の先頭部分から meta 要素の開始タグ (<meta から次の > まで) を順に取り出す。
 * 1 つの正規表現で meta と charset をまとめて探すと、<meta が繰り返される入力で照合が多項式時間になるため、タグごとに切り出す
 */
function metaTags(htmlHead: string): string[] {
  const lowerHtmlHead = htmlHead.toLowerCase();
  const tags: string[] = [];
  for (let start = lowerHtmlHead.indexOf("<meta"); start !== -1; start = lowerHtmlHead.indexOf("<meta", start + 1)) {
    const end = lowerHtmlHead.indexOf(">", start);
    tags.push(htmlHead.slice(start, end === -1 ? undefined : end));
  }
  return tags;
}

/** JSON のレスポンスのヘッダー。origin が許可したオリジンなら CORS のヘッダーを付ける */
function responseHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (origin !== null && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  }
  return headers;
}

/** 失敗の理由を { error } の JSON と、理由に対応する status で返す */
function errorResponse(extractError: ExtractError, origin: string | null): Response {
  return new Response(JSON.stringify({ error: extractError }), {
    status: errorStatuses[extractError],
    headers: responseHeaders(origin),
  });
}
