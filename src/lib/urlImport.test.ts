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
    // 通信が止まった時に取得中のまま戻れなくならないよう、時間の上限付きの signal を渡す
    expect(init.signal).toBeInstanceOf(AbortSignal);
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

  it("認証情報付きの URL は Worker を呼ばずに blocked-url にする", async () => {
    const fetchExtract = fakeExtractFetch(200, {});
    expect(await importFromUrl("https://alice:secret@example.com/a", extractEndpoint, fetchExtract)).toEqual({
      ok: false,
      reason: "blocked-url",
    });
    expect(fetchExtract).not.toHaveBeenCalled();
  });

  it("ページ内の位置 (#...) を除いた URL を Worker に送る", async () => {
    const fetchExtract = fakeExtractFetch(200, { title: "", text: "本文" });
    await importFromUrl("https://example.com/a?b=1#note", extractEndpoint, fetchExtract);
    const [requestUrl] = fetchExtract.mock.calls[0] as unknown as [URL];
    expect(requestUrl.searchParams.get("url")).toBe("https://example.com/a?b=1");
  });

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

  it("{ error } の無い 429 は rate-limited、それ以外の失敗と画面に出さない理由は network にする", async () => {
    const htmlError = (status: number) => vi.fn(async () => new Response("<html>error</html>", { status }));
    expect(await importFromUrl("https://example.com/a", extractEndpoint, htmlError(429))).toEqual({ ok: false, reason: "rate-limited" });
    expect(await importFromUrl("https://example.com/a", extractEndpoint, htmlError(500))).toEqual({ ok: false, reason: "network" });
    expect(
      await importFromUrl("https://example.com/a", extractEndpoint, fakeExtractFetch(403, { error: "forbidden-origin" })),
    ).toEqual({ ok: false, reason: "network" });
  });

  it("タイトルが本文の先頭の段落 (見出し) から始まるなら、タイトルを重ねない", async () => {
    const result = await importFromUrl(
      "https://example.com/a",
      extractEndpoint,
      fakeExtractFetch(200, { title: "速読の方法 - サンプルの百科事典", text: "速読の方法\n\n一段落目。" }),
    );
    expect(result).toEqual({ ok: true, text: "速読の方法\n\n一段落目。" });
  });

  it("Worker の段落ごとの区切りの位置 (units) を、タイトルを足した本文の段落の順に並べて添える", async () => {
    const result = await importFromUrl(
      "https://example.com/a",
      extractEndpoint,
      fakeExtractFetch(200, { title: "速読の方法", text: "一段落目。\n\nEnglish paragraph.\n\n三段落目。", units: [[2], null, [3]] }),
    );
    expect(result).toEqual({
      ok: true,
      text: "速読の方法\n\n一段落目。\n\nEnglish paragraph.\n\n三段落目。",
      // タイトルの段落と、区切りの無い段落は BudouX で分ける
      paragraphBoundaries: [null, [2], null, [3]],
    });
  });

  it.each([
    ["units が無い", undefined],
    ["段落の数と合わない", [[2]]],
    ["区切りが昇順でない", [[3, 2], null]],
    ["区切りのある段落が無い", [null, null]],
  ])("%s時は区切りの位置を添えない", async (_, units) => {
    const result = await importFromUrl(
      "https://example.com/a",
      extractEndpoint,
      fakeExtractFetch(200, { title: "", text: "一段落目。\n\n二段落目。", units }),
    );
    expect(result).toEqual({ ok: true, text: "一段落目。\n\n二段落目。" });
    expect(result.ok && "paragraphBoundaries" in result).toBe(false);
  });

  it("時間の上限で取得を打ち切ったら network にする", async () => {
    const fetchExtract = vi.fn(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    expect(await importFromUrl("https://example.com/a", extractEndpoint, fetchExtract)).toEqual({ ok: false, reason: "network" });
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
