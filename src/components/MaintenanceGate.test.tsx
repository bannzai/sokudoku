// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MaintenanceGate } from "./MaintenanceGate";

/** 本番の状態の URL (状態を返す Worker の URL + サービス名 sokudoku)。NEXT_PUBLIC_MAINTENANCE_STATE_URL を渡さないビルドが読む */
const productionStateURL = "https://service-maintenance.star-kojiki.workers.dev/sokudoku";

/** 状態を返す Worker が返す JSON。overrides で項目を差し替える */
function stateJSON(overrides: Record<string, unknown>) {
  return { maintenance: true, message: null, button: null, source: "owner", changedAt: "2026-11-27T00:00:00.000Z", ...overrides };
}

/** body を JSON で返す応答 */
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("MaintenanceGate", () => {
  /** 次に状態を読んだ時の応答。test ごとに差し替える */
  let respond: (init: { signal: AbortSignal }) => Promise<Response>;
  let fetchState: ReturnType<typeof vi.fn>;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    fetchState = vi.fn((_url: string, init: { signal: AbortSignal }) => respond(init));
    vi.stubGlobal("fetch", fetchState);
    // 前面に戻った時の読み直し (visibilitychange) を、タブが前面にある状態で起こすため
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  /** 通常の画面を MaintenanceGate で包んで出す */
  async function renderGate() {
    await act(async () => root.render(<MaintenanceGate><p>通常の画面</p></MaintenanceGate>));
  }

  /** タブが前面に戻ったことにして、状態を読み直させる */
  async function returnToForeground() {
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  /** 画面の文に text が出るまで待つ */
  async function waitForText(text: string, timeout = 1000) {
    await vi.waitFor(
      async () => {
        await act(async () => {});
        expect(container.textContent).toContain(text);
      },
      { timeout },
    );
  }

  it("メンテナンス中は通常の画面の代わりにメンテナンス中の画面を出し、本番の状態の URL を読む", async () => {
    respond = async () => jsonResponse(stateJSON({}));
    await renderGate();
    await waitForText("メンテナンス中");
    expect(container.textContent).toContain("しばらくしてからもう一度開いてください");
    expect(container.textContent).not.toContain("通常の画面");
    expect(container.querySelector("a")).toBeNull();
    expect(fetchState).toHaveBeenCalledWith(productionStateURL, expect.anything());
  });

  it("状態の message と button があれば、既定の文の代わりにその文とボタンを出す", async () => {
    respond = async () =>
      jsonResponse(stateJSON({ message: "復旧までお待ちください", button: { label: "お知らせを見る", url: "https://example.com/news" } }));
    await renderGate();
    await waitForText("復旧までお待ちください");
    expect(container.textContent).not.toContain("しばらくしてからもう一度開いてください");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com/news");
    expect(container.querySelector("a")?.textContent).toBe("お知らせを見る");
  });

  it("通常に戻った (maintenance: false) 状態を読むと、通常の画面に戻る", async () => {
    respond = async () => jsonResponse(stateJSON({}));
    await renderGate();
    await waitForText("メンテナンス中");
    respond = async () => jsonResponse(stateJSON({ maintenance: false }));
    await returnToForeground();
    await waitForText("通常の画面");
    expect(container.textContent).not.toContain("メンテナンス中");
  });

  it.each<[string, (init: { signal: AbortSignal }) => Promise<Response>]>([
    ["通信の失敗", async () => Promise.reject(new TypeError("fetch failed"))],
    ["500 の応答", async () => jsonResponse({ error: "unavailable" }, 500)],
    ["形の違う応答", async () => jsonResponse(stateJSON({ maintenance: "true" }))],
    // 応答が無いまま、待つ上限 (2 秒。maintenance-state.ts の DEFAULT_FETCH_TIMEOUT_MS) で打ち切られる
    ["時間切れ", (init) => new Promise<Response>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)))],
  ])("状態を読めない時 (%s) は、メンテナンス中の画面から通常の画面に戻して動かす", async (_name, unreadable) => {
    respond = async () => jsonResponse(stateJSON({}));
    await renderGate();
    await waitForText("メンテナンス中");
    respond = unreadable;
    await returnToForeground();
    await waitForText("通常の画面", 4000);
    expect(container.textContent).not.toContain("メンテナンス中");
  });

  it("最初の読み取りで状態を読めない時は、通常の画面のまま動かす", async () => {
    respond = async () => Promise.reject(new TypeError("fetch failed"));
    await renderGate();
    await vi.waitFor(() => expect(fetchState).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(container.textContent).toContain("通常の画面");
    expect(container.textContent).not.toContain("メンテナンス中");
  });
});
