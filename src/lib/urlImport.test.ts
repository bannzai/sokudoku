import { describe, expect, it, vi } from "vitest";
import { importFromUrl } from "./urlImport";

const extractEndpoint = "https://sokudoku-extract.example.workers.dev";

/** Worker の代わりに、決めた status と JSON を返す fetch */
function fakeExtractFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("importFromUrl", () => {
  it("Worker の /extract にページの URL だけを渡し、本文を取り込む", async () => {
    const fetchExtract = fakeExtractFetch(200, { title: "速読の方法", text: "一段落目。\n\n二段落目。", lang: "ja" });
    const result = await importFromUrl(" https://ja.wikipedia.org/wiki/速読 ", extractEndpoint, fetchExtract);
    expect(result).toEqual({ ok: true, text: "速読の方法\n\n一段落目。\n\n二段落目。" });
    const [requestUrl, init] = fetchExtract.mock.calls[0] as unknown as [URL, RequestInit];
    expect(requestUrl.origin).toBe(extractEndpoint);
    expect(requestUrl.pathname).toBe("/extract");
    expect(requestUrl.searchParams.get("url")).toBe("https://ja.wikipedia.org/wiki/%E9%80%9F%E8%AA%AD");
    expect([...requestUrl.searchParams.keys()]).toEqual(["url"]);
    expect(init).toMatchObject({ cache: "no-store", credentials: "omit" });
  });

  it("本文の先頭の段落がタイトルと同じなら、タイトルを重ねない", async () => {
    const result = await importFromUrl(
      "https://example.com/a",
      extractEndpoint,
      fakeExtractFetch(200, { title: "Speed reading", text: "Speed reading\n\nFirst paragraph." }),
    );
    expect(result).toEqual({ ok: true, text: "Speed reading\n\nFirst paragraph." });
  });

  it.each(["example.com/article", "ftp://example.com/", "javascript:alert(1)", ""])(
    "http(s) の URL でない入力 %s は Worker を呼ばずに invalid-url にする",
    async (input) => {
      const fetchExtract = fakeExtractFetch(200, {});
      expect(await importFromUrl(input, extractEndpoint, fetchExtract)).toEqual({ ok: false, reason: "invalid-url" });
      expect(fetchExtract).not.toHaveBeenCalled();
    },
  );

  it.each([
    [422, "unextractable"],
    [429, "rate-limited"],
    [400, "blocked-url"],
    [403, "robots-disallowed"],
    [413, "page-too-large"],
    [502, "page-unavailable"],
  ] as const)("Worker が %i と { error: %s } を返したら、その理由で失敗にする", async (status, error) => {
    expect(await importFromUrl("https://example.com/a", extractEndpoint, fakeExtractFetch(status, { error }))).toEqual({
      ok: false,
      reason: error,
    });
  });

  it("{ error } の無い 429 は rate-limited、それ以外の失敗は page-unavailable にする", async () => {
    const htmlError = (status: number) => vi.fn(async () => new Response("<html>error</html>", { status }));
    expect(await importFromUrl("https://example.com/a", extractEndpoint, htmlError(429))).toEqual({ ok: false, reason: "rate-limited" });
    expect(await importFromUrl("https://example.com/a", extractEndpoint, htmlError(500))).toEqual({ ok: false, reason: "page-unavailable" });
  });

  it("Worker に接続できなければ network にする", async () => {
    const fetchExtract = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await importFromUrl("https://example.com/a", extractEndpoint, fetchExtract)).toEqual({ ok: false, reason: "network" });
  });

  it("成功のレスポンスの形が違えば unextractable、本文が空なら empty にする", async () => {
    expect(await importFromUrl("https://example.com/a", extractEndpoint, fakeExtractFetch(200, { text: 1 }))).toEqual({
      ok: false,
      reason: "unextractable",
    });
    expect(await importFromUrl("https://example.com/a", extractEndpoint, fakeExtractFetch(200, { title: " ", text: " " }))).toEqual({
      ok: false,
      reason: "empty",
    });
  });
});
