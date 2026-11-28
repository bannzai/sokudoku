// @vitest-environment jsdom
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MaintenanceResolver } from "./MaintenanceResolver";

/** 本番の状態の URL (状態を返す Worker の URL + サービス名 sokudoku)。NEXT_PUBLIC_MAINTENANCE_STATE_URL を渡さないビルドが読む */
const productionStateURL = "https://service-maintenance.star-kojiki.workers.dev/sokudoku";

/** 状態を返す Worker が返す JSON。overrides で項目を差し替える */
function stateJSON(overrides: Record<string, unknown>) {
  return { maintenance: true, message: null, button: null, source: "owner", changedAt: "2026-11-27T00:00:00.000Z", ...overrides };
}

/**
 * body を JSON にした応答を返す。status の既定 200 は状態を返す Worker が読めた時の status で、
 * 読めない応答を確かめる test だけが差し替える
 */
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("MaintenanceResolver", () => {
  /** 状態を読んだ時の応答。test ごとに差し替える */
  let respond: (init: { signal: AbortSignal }) => Promise<Response>;
  let fetchState: ReturnType<typeof vi.fn>;
  /** 本来の画面が作られた (mount された) 回数 */
  let normalScreenMounts: number;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    fetchState = vi.fn((_url: string, init: { signal: AbortSignal }) => respond(init));
    vi.stubGlobal("fetch", fetchState);
    normalScreenMounts = 0;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  /** 本来の画面の代わり。作られた回数を数える */
  function NormalScreen() {
    useEffect(() => {
      normalScreenMounts += 1;
    }, []);
    return <p>通常の画面</p>;
  }

  /** 本来の画面を MaintenanceResolver で包んで出す */
  async function renderResolver(Resolver = MaintenanceResolver) {
    await act(async () => root.render(<Resolver><NormalScreen /></Resolver>));
  }

  /**
   * 画面の文に text が出るまで待つ。timeout の既定 1000 ms は vi.waitFor の既定と同じで、
   * テストの偽の fetch はすぐ応答するため足りる。時間切れの確かめだけは打ち切りの 2 秒を超えて待つ値を渡す
   */
  async function waitForText(text: string, timeout = 1000) {
    await vi.waitFor(
      async () => {
        await act(async () => {});
        expect(container.textContent).toContain(text);
      },
      { timeout },
    );
  }

  it("メンテナンス中はメンテナンス中の画面だけを出し、本来の画面を作らない。本番の状態の URL を読む", async () => {
    respond = async () => jsonResponse(stateJSON({}));
    await renderResolver();
    await waitForText("メンテナンス中");
    expect(container.textContent).toContain("しばらくしてからもう一度開いてください");
    expect(container.textContent).not.toContain("通常の画面");
    expect(normalScreenMounts).toBe(0);
    // button が null の時は、ボタンも AppBar のトップページへのリンクも出さない (メンテナンス中は同じ画面に戻るだけのため)
    expect(container.querySelector("a")).toBeNull();
    expect(fetchState).toHaveBeenCalledWith(productionStateURL, expect.anything());
  });

  it("利用量で切り替わった (source: usage) メンテナンス中も、メンテナンス中の画面だけを出す", async () => {
    respond = async () => jsonResponse(stateJSON({ source: "usage" }));
    await renderResolver();
    await waitForText("メンテナンス中");
    expect(normalScreenMounts).toBe(0);
  });

  it("状態の message と button があれば、既定の文の代わりにその文とボタンを出す", async () => {
    respond = async () =>
      jsonResponse(stateJSON({ message: "復旧までお待ちください", button: { label: "お知らせを見る", url: "https://example.com/news" } }));
    await renderResolver();
    await waitForText("復旧までお待ちください");
    expect(container.textContent).not.toContain("しばらくしてからもう一度開いてください");
    expect(container.querySelector("main a")?.getAttribute("href")).toBe("https://example.com/news");
    expect(container.querySelector("main a")?.textContent).toBe("お知らせを見る");
  });

  it("メンテナンス中でない (maintenance: false) 時は本来の画面を出す", async () => {
    respond = async () => jsonResponse(stateJSON({ maintenance: false }));
    await renderResolver();
    await waitForText("通常の画面");
    expect(container.textContent).not.toContain("メンテナンス中");
    expect(normalScreenMounts).toBe(1);
  });

  it("状態を読み終わるまでは、メンテナンス中の画面も本来の画面も出さない", async () => {
    respond = () => new Promise<Response>(() => {});
    await renderResolver();
    await act(async () => {});
    expect(container.textContent).toBe("");
    expect(normalScreenMounts).toBe(0);
  });

  it.each<[string, (init: { signal: AbortSignal }) => Promise<Response>]>([
    ["通信の失敗", async () => Promise.reject(new TypeError("fetch failed"))],
    ["500 の応答", async () => jsonResponse({ error: "unavailable" }, 500)],
    ["形の違う応答", async () => jsonResponse(stateJSON({ maintenance: "true" }))],
    // 応答が無いまま、待つ上限 (2 秒。maintenance-state.ts の DEFAULT_FETCH_TIMEOUT_MS) で打ち切られる
    ["時間切れ", (init) => new Promise<Response>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)))],
  ])("状態を読めない時 (%s) は本来の画面を出す", async (_name, unreadable) => {
    respond = unreadable;
    await renderResolver();
    // 時間切れは打ち切りの 2 秒 (DEFAULT_FETCH_TIMEOUT_MS) の後に起きるため、その 2 倍まで待つ
    await waitForText("通常の画面", 4000);
    expect(container.textContent).not.toContain("メンテナンス中");
    expect(normalScreenMounts).toBe(1);
  });

  it("StrictMode が effect を 2 回動かした時は、先に破棄された回の結果で画面を決めない", async () => {
    // 1 回目 (破棄される回) は maintenance: true を返し、2 回目より後に解決させる
    const resolvers: Array<(response: Response) => void> = [];
    respond = () => new Promise<Response>((resolve) => resolvers.push(resolve));
    await act(async () =>
      root.render(
        <StrictMode>
          <MaintenanceResolver>
            <NormalScreen />
          </MaintenanceResolver>
        </StrictMode>,
      ),
    );
    expect(resolvers).toHaveLength(2);
    await act(async () => resolvers[1](jsonResponse(stateJSON({ maintenance: false }))));
    await waitForText("通常の画面");
    await act(async () => resolvers[0](jsonResponse(stateJSON({}))));
    await act(async () => {});
    expect(container.textContent).toContain("通常の画面");
    expect(container.textContent).not.toContain("メンテナンス中");
  });

  it("タブを背面・前面に切り替えても、時間が進んでも、状態の読み取りは 1 回のまま", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    respond = async () => jsonResponse(stateJSON({}));
    await renderResolver();
    await act(async () => {});
    expect(container.textContent).toContain("メンテナンス中");
    for (const visibility of ["hidden", "visible", "hidden", "visible"]) {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("focus"));
      });
    }
    // 時間の経過で読み直していないことを確かめるため、サーバーが状態を覚える時間 (60 秒。maintenance-state.ts の DEFAULT_SERVER_CACHE_MS) を何度も過ぎる 10 分を進める
    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(fetchState).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("メンテナンス中");
  });

  it("ビルド時の NEXT_PUBLIC_MAINTENANCE_STATE_URL があれば、本番の代わりにその URL を読む", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAINTENANCE_STATE_URL", "http://127.0.0.1:8787/state");
    vi.resetModules();
    const { MaintenanceResolver: ResolverWithOverride } = await import("./MaintenanceResolver");
    respond = async () => jsonResponse(stateJSON({}));
    await renderResolver(ResolverWithOverride);
    await waitForText("メンテナンス中");
    expect(fetchState).toHaveBeenCalledWith("http://127.0.0.1:8787/state", expect.anything());
    expect(fetchState).not.toHaveBeenCalledWith(productionStateURL, expect.anything());
  });
});
