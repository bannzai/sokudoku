import { describe, expect, it, vi } from "vitest";
import { articleHtml, articleParagraphs } from "./__fixtures__/articlePage";
import { decodeHtml, type Env, handleRequest } from "./index";

/** URL ごとに返すレスポンスを決めた fetch の代わり。呼ばれた URL と init を記録する */
function fakeFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const route = routes[input.toString()];
    if (!route) {
      throw new TypeError(`unexpected fetch: ${input.toString()} ${JSON.stringify(init?.headers)}`);
    }
    return route();
  });
}

/** 指定した回数まで通す Rate Limiting binding の代わり */
function fakeEnv(allowedCount = Number.POSITIVE_INFINITY): Env {
  let count = 0;
  return {
    EXTRACT_RATE_LIMITER: {
      limit: async () => {
        count += 1;
        return { success: count <= allowedCount };
      },
    },
  };
}

/** html を本文に持つ 200 の HTML のレスポンス。headers は既定のヘッダーに足す・上書きする */
function htmlResponse(html: string, headers: Record<string, string> = {}) {
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });
}

/** robots.txt が無いサイトのレスポンス (RFC 9309 では制限なしとして扱う) */
const robotsNotFound = () => new Response("not found", { status: 404 });

/** フロント (既定は公開サイトのオリジン) から targetUrl の本文を求める /extract のリクエスト。origin に null を渡すと Origin を付けない */
function extractRequest(targetUrl: string, init: RequestInit & { origin?: string | null } = {}) {
  const { origin = "https://bannzai.github.io", ...requestInit } = init;
  return new Request(`https://sokudoku-extract.example.workers.dev/extract?url=${encodeURIComponent(targetUrl)}`, {
    ...requestInit,
    headers: { ...(origin ? { Origin: origin } : {}), "CF-Connecting-IP": "203.0.113.1" },
  });
}

describe("handleRequest", () => {
  it("公開ページの本文を { title, text, siteName, lang } の JSON で返し、許可したオリジンに CORS のヘッダーを付ける", async () => {
    const fetchPage = fakeFetch({
      "https://example.com/robots.txt": robotsNotFound,
      "https://example.com/article": () => htmlResponse(articleHtml),
    });
    const response = await handleRequest(extractRequest("https://example.com/article"), fakeEnv(), fetchPage);
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://bannzai.github.io");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ title: "速読の方法 - サンプルの百科事典", siteName: "サンプルの百科事典", lang: "ja" });
    expect(body.text).toContain(articleParagraphs[1]);
  });

  it("取得には User-Agent で名乗り、キャッシュを使わず、リダイレクトを自分で追う", async () => {
    const fetchPage = fakeFetch({
      "https://example.com/robots.txt": robotsNotFound,
      "https://example.com/article": () => htmlResponse(articleHtml),
    });
    await handleRequest(extractRequest("https://example.com/article"), fakeEnv(), fetchPage);
    const pageInit = fetchPage.mock.calls.find(([input]) => input.toString() === "https://example.com/article")?.[1];
    expect(pageInit).toMatchObject({ redirect: "manual", cache: "no-store" });
    expect(new Headers(pageInit?.headers).get("User-Agent")).toBe("sokudoku-extract/1.0 (+https://bannzai.github.io/sokudoku/)");
  });

  it("http(s) でない URL を 400 の invalid-url にし、取得しない", async () => {
    const fetchPage = fakeFetch({});
    const response = await handleRequest(extractRequest("file:///etc/passwd"), fakeEnv(), fetchPage);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid-url" });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("プライベートアドレスを 400 の blocked-url にし、取得しない", async () => {
    const fetchPage = fakeFetch({});
    const response = await handleRequest(extractRequest("http://192.168.0.1/admin"), fakeEnv(), fetchPage);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "blocked-url" });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("プライベートアドレスへのリダイレクトを 400 の blocked-url にし、転送先を取得しない", async () => {
    const fetchPage = fakeFetch({
      "https://example.com/robots.txt": robotsNotFound,
      "https://example.com/redirect": () => new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest" } }),
    });
    const response = await handleRequest(extractRequest("https://example.com/redirect"), fakeEnv(), fetchPage);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "blocked-url" });
    expect(fetchPage.mock.calls.map(([input]) => input.toString())).not.toContain("http://169.254.169.254/latest");
  });

  it("相対の Location を追い、転送先のオリジンの robots.txt も確かめる", async () => {
    const fetchPage = fakeFetch({
      "http://example.com/robots.txt": robotsNotFound,
      "http://example.com/a": () => new Response(null, { status: 301, headers: { Location: "https://www.example.com/a" } }),
      "https://www.example.com/robots.txt": robotsNotFound,
      "https://www.example.com/a": () => new Response(null, { status: 302, headers: { Location: "/article" } }),
      "https://www.example.com/article": () => htmlResponse(articleHtml),
    });
    const response = await handleRequest(extractRequest("http://example.com/a"), fakeEnv(), fetchPage);
    expect(response.status).toBe(200);
    expect(fetchPage.mock.calls.map(([input]) => input.toString())).toContain("https://www.example.com/robots.txt");
  });

  it("6 回目のリダイレクトで追うのをやめて 502 の page-unavailable にする", async () => {
    const routes: Record<string, () => Response> = { "https://example.com/robots.txt": robotsNotFound };
    for (let index = 0; index <= 6; index += 1) {
      routes[`https://example.com/r${index}`] = () =>
        new Response(null, { status: 302, headers: { Location: `https://example.com/r${index + 1}` } });
    }
    const fetchPage = fakeFetch(routes);
    const response = await handleRequest(extractRequest("https://example.com/r0"), fakeEnv(), fetchPage);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "page-unavailable" });
    expect(fetchPage.mock.calls.filter(([input]) => input.toString() !== "https://example.com/robots.txt")).toHaveLength(6);
  });

  it("Content-Length が 5 MB を超えるページを 413 の page-too-large にする", async () => {
    const fetchPage = fakeFetch({
      "https://example.com/robots.txt": robotsNotFound,
      "https://example.com/huge": () => htmlResponse("<p>x</p>", { "Content-Length": String(5 * 1024 * 1024 + 1) }),
    });
    const response = await handleRequest(extractRequest("https://example.com/huge"), fakeEnv(), fetchPage);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "page-too-large" });
  });

  it("Content-Length が無くても、読んだ本文が 5 MB を超えた時点で 413 の page-too-large にする", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x61);
    const fetchPage = fakeFetch({
      "https://example.com/robots.txt": robotsNotFound,
      "https://example.com/stream": () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(chunk);
            },
          }),
          { status: 200, headers: { "Content-Type": "text/html" } },
        ),
    });
    const response = await handleRequest(extractRequest("https://example.com/stream"), fakeEnv(), fetchPage);
    expect(response.status).toBe(413);
  });

  it("本文を取り出せないページを 422 の unextractable にする", async () => {
    const fetchPage = fakeFetch({
      "https://example.com/robots.txt": robotsNotFound,
      "https://example.com/empty": () => htmlResponse("<!doctype html><html><body><img src=a.png></body></html>"),
    });
    const response = await handleRequest(extractRequest("https://example.com/empty"), fakeEnv(), fetchPage);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "unextractable" });
  });

  it("HTML でないページを 422 の unextractable にする", async () => {
    const fetchPage = fakeFetch({
      "https://example.com/robots.txt": robotsNotFound,
      "https://example.com/file.pdf": () => new Response("%PDF", { headers: { "Content-Type": "application/pdf" } }),
    });
    const response = await handleRequest(extractRequest("https://example.com/file.pdf"), fakeEnv(), fetchPage);
    expect(response.status).toBe(422);
  });

  it("robots.txt が Disallow したページを 403 の robots-disallowed にし、ページを取得しない", async () => {
    const fetchPage = fakeFetch({
      "https://example.com/robots.txt": () => new Response("User-agent: *\nDisallow: /members/\n"),
    });
    const response = await handleRequest(extractRequest("https://example.com/members/article"), fakeEnv(), fetchPage);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "robots-disallowed" });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("robots.txt が 5xx のサイトは取得せず 502 の page-unavailable にする", async () => {
    const fetchPage = fakeFetch({
      "https://example.com/robots.txt": () => new Response("error", { status: 503 }),
    });
    const response = await handleRequest(extractRequest("https://example.com/article"), fakeEnv(), fetchPage);
    expect(response.status).toBe(502);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("ページが 4xx・5xx なら 502 の page-unavailable にする (ログインが必要なページを含む)", async () => {
    const fetchPage = fakeFetch({
      "https://example.com/robots.txt": robotsNotFound,
      "https://example.com/paywall": () => new Response("login required", { status: 401 }),
    });
    const response = await handleRequest(extractRequest("https://example.com/paywall"), fakeEnv(), fetchPage);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "page-unavailable" });
  });

  it("接続の失敗・タイムアウトを 502 の page-unavailable にする", async () => {
    const fetchPage = vi.fn(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    const response = await handleRequest(extractRequest("https://example.com/slow"), fakeEnv(), fetchPage);
    expect(response.status).toBe(502);
  });

  it("同じ IP からの回数が上限を超えたら 429 の rate-limited にし、取得しない", async () => {
    const fetchPage = fakeFetch({
      "https://example.com/robots.txt": robotsNotFound,
      "https://example.com/article": () => htmlResponse(articleHtml),
    });
    const env = fakeEnv(1);
    expect((await handleRequest(extractRequest("https://example.com/article"), env, fetchPage)).status).toBe(200);
    fetchPage.mockClear();
    const response = await handleRequest(extractRequest("https://example.com/article"), env, fetchPage);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate-limited" });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("許可していないオリジンからの呼び出しを 403 にし、CORS のヘッダーを付けない", async () => {
    const fetchPage = fakeFetch({});
    const response = await handleRequest(extractRequest("https://example.com/article", { origin: "https://evil.example" }), fakeEnv(), fetchPage);
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("make dev の dev サーバ (http://localhost:3000) からの呼び出しを許可する", async () => {
    const response = await handleRequest(
      extractRequest("file:///", { origin: "http://localhost:3000" }),
      fakeEnv(),
      fakeFetch({}),
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
  });

  it("/extract 以外のパスは 404、GET 以外は 405 にする", async () => {
    const notFound = await handleRequest(new Request("https://sokudoku-extract.example.workers.dev/"), fakeEnv(), fakeFetch({}));
    expect(notFound.status).toBe(404);
    const post = await handleRequest(extractRequest("https://example.com/", { method: "POST" }), fakeEnv(), fakeFetch({}));
    expect(post.status).toBe(405);
  });
});

describe("decodeHtml", () => {
  it("Content-Type の charset で読む", () => {
    // 「速読」の Shift_JIS のバイト列
    const bytes = new Uint8Array([0x91, 0xac, 0x93, 0xc7]);
    expect(decodeHtml(bytes, "text/html; charset=Shift_JIS")).toBe("速読");
  });

  it("Content-Type に charset が無ければ meta の charset で読む", () => {
    const head = new TextEncoder().encode('<meta http-equiv="Content-Type" content="text/html; charset=EUC-JP">');
    // 「速読」の EUC-JP のバイト列
    const bytes = new Uint8Array([...head, 0xc2, 0xae, 0xc6, 0xc9]);
    expect(decodeHtml(bytes, "text/html")).toContain("速読");
  });

  it("charset が無い・未対応の名前なら UTF-8 で読む", () => {
    const bytes = new TextEncoder().encode("速読");
    expect(decodeHtml(bytes, "text/html")).toBe("速読");
    expect(decodeHtml(bytes, "text/html; charset=x-unknown")).toBe("速読");
  });
});
