import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "./index";

// 極端に深い入れ子の HTML などで解析が例外になった場合を、本文の抽出を例外にして再現する
vi.mock("./extract", () => ({
  extractArticle: () => {
    throw new RangeError("Maximum call stack size exceeded");
  },
}));

describe("handleRequest の本文の抽出の例外", () => {
  it("抽出が例外になったページを 422 の unextractable にする", async () => {
    const fetchPage = vi.fn(async (input: RequestInfo | URL) =>
      input.toString().endsWith("/robots.txt")
        ? new Response("not found", { status: 404 })
        : new Response("<p>本文</p>", { headers: { "Content-Type": "text/html" } }),
    );
    const response = await handleRequest(
      new Request(`https://sokudoku-extract.example.workers.dev/extract?url=${encodeURIComponent("https://example.com/deep")}`),
      { EXTRACT_RATE_LIMITER: { limit: async () => ({ success: true }) }, AI: { run: vi.fn() } },
      fetchPage,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "unextractable" });
  });
});
