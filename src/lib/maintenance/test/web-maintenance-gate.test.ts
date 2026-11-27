import { afterEach, assert, beforeEach, test, vi } from "vitest";

import { mountMaintenanceGate, watchMaintenanceState } from "../web-maintenance-gate";
import {
  IN_MAINTENANCE_WITH_BUTTON_JSON,
  IN_MAINTENANCE_WITHOUT_BUTTON_JSON,
  NOT_IN_MAINTENANCE_JSON,
  STATE_URL,
} from "./support/fixtures";

/** テスト用の DOM の要素。雛形が使う操作 (属性・文・子の追加・自分の削除) だけを持つ */
type FakeElement = {
  /** 要素の種類 ("div"・"p"・"a"・"body") */
  tagName: string;
  /** append された子 */
  children: FakeElement[];
  /** setAttribute された属性 */
  attributes: Record<string, string>;
  /** 要素の文 */
  textContent: string;
  /** インラインの style */
  style: { cssText: string };
  /** append された先 */
  parent: FakeElement | null;
  /** 属性を設定する */
  setAttribute(name: string, value: string): void;
  /** 属性を外す */
  removeAttribute(name: string): void;
  /** 属性があるか */
  hasAttribute(name: string): boolean;
  /** child を子の末尾に足す */
  append(child: FakeElement): void;
  /** 自分を親から外す */
  remove(): void;
};

/** tagName の、子も属性も無い FakeElement を作る */
function fakeElement(tagName: string): FakeElement {
  const element: FakeElement = {
    tagName,
    children: [],
    attributes: {},
    textContent: "",
    style: { cssText: "" },
    parent: null,
    setAttribute: (name, value) => {
      element.attributes[name] = value;
    },
    removeAttribute: (name) => {
      delete element.attributes[name];
    },
    hasAttribute: (name) => name in element.attributes,
    append: (child) => {
      child.parent = element;
      element.children.push(child);
    },
    remove: () => {
      if (element.parent !== null) element.parent.children = element.parent.children.filter((child) => child !== element);
      element.parent = null;
    },
  };
  return element;
}

/**
 * 返った Promise の続き (then の処理) を流し切るために、setImmediate を待つ回数。
 * fetch の代わり → json() → parse → onState の連鎖は 10 段に収まり、その倍にした
 */
const SETTLE_TICKS = 20;

/** SETTLE_TICKS 回 setImmediate を待ち、待っている Promise の続きを流し切る */
async function settlePromises(): Promise<void> {
  for (let tick = 0; tick < SETTLE_TICKS; tick += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** テスト用の document。前面・背面の切り替えを setVisibility で起こせる */
function fakeDocument() {
  const listeners = new Set<() => void>();
  const body = fakeElement("body");
  const fake = {
    body,
    visibilityState: "visible",
    createElement: (tagName: string) => fakeElement(tagName),
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  return {
    document: fake as unknown as Document,
    body,
    listenerCount: () => listeners.size,
    setVisibility: (visibilityState: "visible" | "hidden") => {
      fake.visibilityState = visibilityState;
      for (const listener of listeners) listener();
    },
  };
}

/** 返す応答を後から差し替えられる fetch の代わり。呼ばれた回数を数える */
function switchableFetch(initialBody: unknown) {
  const control = {
    body: initialBody,
    fail: false,
    calls: 0,
    fetchImpl: async () => {
      control.calls += 1;
      if (control.fail) throw new TypeError("fetch failed");
      return new Response(JSON.stringify(control.body));
    },
  };
  return control;
}

/** condition が成り立つまで待つ。成り立たないまま 1000 回確かめたら落とす */
async function waitFor(condition: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`待った条件が成り立たなかった: ${description}`);
}

beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }));
afterEach(() => vi.useRealTimers());

test("メンテナンス中は、状態の文とボタンを持つ画面を body に出す", async () => {
  const { document, body } = fakeDocument();
  const stop = mountMaintenanceGate({ stateURL: STATE_URL, defaultMessage: "ただいまメンテナンス中です", document, fetchImpl: switchableFetch(IN_MAINTENANCE_WITH_BUTTON_JSON).fetchImpl });
  await waitFor(() => body.children.length === 1, "メンテナンス中の画面が出る");
  const [message, button] = body.children[0].children;
  assert.strictEqual(body.children[0].children.length, 2);
  assert.strictEqual(message.tagName, "p");
  assert.strictEqual(message.textContent, "復旧までお待ちください");
  assert.strictEqual(button.tagName, "a");
  assert.strictEqual(button.textContent, "お知らせを見る");
  assert.strictEqual(button.attributes.href, "https://example.com/news");
  stop();
});

test("button が null の時はボタンを出さず、message が null の時はサービスの既定の文を出す", async () => {
  const { document, body } = fakeDocument();
  const stop = mountMaintenanceGate({ stateURL: STATE_URL, defaultMessage: "ただいまメンテナンス中です", document, fetchImpl: switchableFetch(IN_MAINTENANCE_WITHOUT_BUTTON_JSON).fetchImpl });
  await waitFor(() => body.children.length === 1, "メンテナンス中の画面が出る");
  assert.deepEqual(
    body.children[0].children.map((child) => child.tagName),
    ["p"],
  );
  assert.strictEqual(body.children[0].children[0].textContent, "ただいまメンテナンス中です");
  stop();
});

test("メンテナンス中でない時は画面を出さない", async () => {
  const { document, body } = fakeDocument();
  const states: boolean[] = [];
  const control = switchableFetch(NOT_IN_MAINTENANCE_JSON);
  const stopWatching = watchMaintenanceState({ stateURL: STATE_URL, document, fetchImpl: control.fetchImpl, onState: (state) => states.push(state.maintenance) });
  const stop = mountMaintenanceGate({ stateURL: STATE_URL, defaultMessage: "ただいまメンテナンス中です", document, fetchImpl: control.fetchImpl });
  await waitFor(() => states.length === 1 && control.calls === 2, "2 つの読み取りが終わる");
  assert.deepEqual(states, [false]);
  assert.strictEqual(body.children.length, 0);
  stopWatching();
  stop();
});

test("状態を読めなくなったら、出ていたメンテナンス中の画面を消して通常の画面に戻す", async () => {
  const { document, body, setVisibility } = fakeDocument();
  const control = switchableFetch(IN_MAINTENANCE_WITH_BUTTON_JSON);
  const stop = mountMaintenanceGate({ stateURL: STATE_URL, defaultMessage: "ただいまメンテナンス中です", document, fetchImpl: control.fetchImpl });
  await waitFor(() => body.children.length === 1, "メンテナンス中の画面が出る");
  control.fail = true;
  setVisibility("visible");
  await waitFor(() => body.children.length === 0, "メンテナンス中の画面が消える");
  assert.strictEqual(control.calls, 2);
  stop();
});

test("メンテナンス中は通常の画面の要素を inert にし、終わると戻す (元から inert の要素は inert のまま残す)", async () => {
  const { document, body } = fakeDocument();
  const normalScreen = fakeElement("main");
  const alreadyInert = fakeElement("aside");
  alreadyInert.setAttribute("inert", "");
  body.append(normalScreen);
  body.append(alreadyInert);
  const control = switchableFetch(NOT_IN_MAINTENANCE_JSON);
  const stop = mountMaintenanceGate({ stateURL: STATE_URL, defaultMessage: "ただいまメンテナンス中です", document, fetchImpl: control.fetchImpl });
  await waitFor(() => control.calls === 1, "起動時に読む");
  assert.strictEqual(normalScreen.hasAttribute("inert"), false);

  control.body = IN_MAINTENANCE_WITH_BUTTON_JSON;
  vi.advanceTimersByTime(60_000);
  await waitFor(() => body.children.length === 3, "メンテナンス中の画面が出る");
  assert.strictEqual(normalScreen.hasAttribute("inert"), true);
  assert.strictEqual(body.children[2].hasAttribute("inert"), false);

  control.body = NOT_IN_MAINTENANCE_JSON;
  vi.advanceTimersByTime(60_000);
  await waitFor(() => body.children.length === 2, "メンテナンス中の画面が消える");
  assert.strictEqual(normalScreen.hasAttribute("inert"), false);
  assert.strictEqual(alreadyInert.hasAttribute("inert"), true);
  stop();
});

test("同じ状態を読み直した時は画面を作り直さず、文が変わった時は作り直す", async () => {
  const { document, body } = fakeDocument();
  const control = switchableFetch(IN_MAINTENANCE_WITH_BUTTON_JSON);
  const stop = mountMaintenanceGate({ stateURL: STATE_URL, defaultMessage: "ただいまメンテナンス中です", document, fetchImpl: control.fetchImpl });
  await waitFor(() => body.children.length === 1, "メンテナンス中の画面が出る");
  const firstScreen = body.children[0];

  vi.advanceTimersByTime(60_000);
  await waitFor(() => control.calls === 2, "読み直す");
  await settlePromises();
  assert.strictEqual(body.children[0], firstScreen);

  control.body = { ...IN_MAINTENANCE_WITH_BUTTON_JSON, message: "あと 1 時間ほどで復旧します" };
  vi.advanceTimersByTime(60_000);
  await waitFor(() => body.children[0] !== firstScreen, "画面を作り直す");
  assert.strictEqual(body.children.length, 1);
  assert.strictEqual(body.children[0].children[0].textContent, "あと 1 時間ほどで復旧します");
  stop();
});

test("止めると、inert にした通常の画面の要素を戻す", async () => {
  const { document, body } = fakeDocument();
  const normalScreen = fakeElement("main");
  body.append(normalScreen);
  const stop = mountMaintenanceGate({
    stateURL: STATE_URL,
    defaultMessage: "ただいまメンテナンス中です",
    document,
    fetchImpl: switchableFetch(IN_MAINTENANCE_WITH_BUTTON_JSON).fetchImpl,
  });
  await waitFor(() => body.children.length === 2, "メンテナンス中の画面が出る");
  assert.strictEqual(normalScreen.hasAttribute("inert"), true);
  stop();
  assert.deepEqual(body.children, [normalScreen]);
  assert.strictEqual(normalScreen.hasAttribute("inert"), false);
});

test("最初から状態を読めない時は、onState にメンテナンス中でない状態を渡す", async () => {
  const { document } = fakeDocument();
  const states: boolean[] = [];
  const control = switchableFetch(IN_MAINTENANCE_WITH_BUTTON_JSON);
  control.fail = true;
  const stop = watchMaintenanceState({ stateURL: STATE_URL, document, fetchImpl: control.fetchImpl, onState: (state) => states.push(state.maintenance) });
  await waitFor(() => states.length === 1, "onState が呼ばれる");
  assert.deepEqual(states, [false]);
  stop();
});

test("既定では 60 秒ごとに読み直し、切り替わった状態で画面を出し入れする", async () => {
  const { document, body } = fakeDocument();
  const control = switchableFetch(NOT_IN_MAINTENANCE_JSON);
  const stop = mountMaintenanceGate({ stateURL: STATE_URL, defaultMessage: "ただいまメンテナンス中です", document, fetchImpl: control.fetchImpl });
  await waitFor(() => control.calls === 1, "起動時に読む");
  control.body = IN_MAINTENANCE_WITH_BUTTON_JSON;
  vi.advanceTimersByTime(59_999);
  assert.strictEqual(control.calls, 1);
  vi.advanceTimersByTime(1);
  await waitFor(() => body.children.length === 1, "メンテナンス中の画面が出る");
  assert.strictEqual(control.calls, 2);
  control.body = NOT_IN_MAINTENANCE_JSON;
  vi.advanceTimersByTime(60_000);
  await waitFor(() => body.children.length === 0, "メンテナンス中の画面が消える");
  assert.strictEqual(control.calls, 3);
  stop();
});

test("pollIntervalMs で読み直す間隔を変えられる", async () => {
  const { document } = fakeDocument();
  const control = switchableFetch(NOT_IN_MAINTENANCE_JSON);
  const stop = watchMaintenanceState({ stateURL: STATE_URL, document, fetchImpl: control.fetchImpl, pollIntervalMs: 5_000, onState: () => {} });
  await waitFor(() => control.calls === 1, "起動時に読む");
  vi.advanceTimersByTime(5_000);
  assert.strictEqual(control.calls, 2);
  stop();
});

test("背面にいる間は時間が過ぎても読まず、前面に戻った後はまた間隔ごとに読む", async () => {
  const { document, setVisibility } = fakeDocument();
  const control = switchableFetch(NOT_IN_MAINTENANCE_JSON);
  const stop = watchMaintenanceState({ stateURL: STATE_URL, document, fetchImpl: control.fetchImpl, onState: () => {} });
  await waitFor(() => control.calls === 1, "起動時に読む");
  setVisibility("hidden");
  vi.advanceTimersByTime(180_000);
  assert.strictEqual(control.calls, 1);
  setVisibility("visible");
  assert.strictEqual(control.calls, 2);
  vi.advanceTimersByTime(60_000);
  assert.strictEqual(control.calls, 3);
  stop();
});

test("前面に戻った時に読み、背面に回った時は読まない", async () => {
  const { document, setVisibility } = fakeDocument();
  const control = switchableFetch(NOT_IN_MAINTENANCE_JSON);
  const stop = watchMaintenanceState({ stateURL: STATE_URL, document, fetchImpl: control.fetchImpl, onState: () => {} });
  await waitFor(() => control.calls === 1, "起動時に読む");
  setVisibility("hidden");
  assert.strictEqual(control.calls, 1);
  setVisibility("visible");
  assert.strictEqual(control.calls, 2);
  stop();
});

test("後から始めた読み取りが先に返った時は、古い読み取りの結果を渡さない", async () => {
  const { document, setVisibility } = fakeDocument();
  const pendingResponses: ((response: Response) => void)[] = [];
  const states: boolean[] = [];
  const stop = watchMaintenanceState({
    stateURL: STATE_URL,
    document,
    fetchImpl: () => new Promise((resolve) => pendingResponses.push(resolve)),
    onState: (state) => states.push(state.maintenance),
  });
  setVisibility("visible");
  assert.strictEqual(pendingResponses.length, 2);
  pendingResponses[1](new Response(JSON.stringify(NOT_IN_MAINTENANCE_JSON)));
  await waitFor(() => states.length === 1, "後から始めた読み取りの結果が渡る");
  pendingResponses[0](new Response(JSON.stringify(IN_MAINTENANCE_WITH_BUTTON_JSON)));
  await settlePromises();
  assert.deepEqual(states, [false]);
  stop();
});

test("止めると、出ていた画面を消し、前面に戻っても時間が過ぎても読まない", async () => {
  const { document, body, listenerCount, setVisibility } = fakeDocument();
  const control = switchableFetch(IN_MAINTENANCE_WITH_BUTTON_JSON);
  const stop = mountMaintenanceGate({ stateURL: STATE_URL, defaultMessage: "ただいまメンテナンス中です", document, fetchImpl: control.fetchImpl });
  await waitFor(() => body.children.length === 1, "メンテナンス中の画面が出る");
  assert.strictEqual(listenerCount(), 1);
  stop();
  assert.strictEqual(body.children.length, 0);
  assert.strictEqual(listenerCount(), 0);
  setVisibility("visible");
  vi.advanceTimersByTime(120_000);
  assert.strictEqual(control.calls, 1);
});
