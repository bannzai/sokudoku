import { describe, expect, it, vi } from "vitest";
import { type Ai, segmentParagraphs } from "./segment";

/** 段落を受け取り、その段落に対する応答を返す Workers AI の代わり。呼ばれた段落を記録する */
function fakeAi(respond: (paragraph: string) => unknown) {
  return {
    run: vi.fn(async (_model: string, inputs: Record<string, unknown>) =>
      respond((inputs.messages as { role: string; content: string }[]).find(({ role }) => role === "user")?.content ?? ""),
    ),
  };
}

describe("segmentParagraphs", () => {
  it("区切った単位の文字列から、段落の中で単位が始まる位置を返す", async () => {
    const ai = fakeAi(() => ({ response: { units: ["吾輩は", "猫である。"] } }));
    expect(await segmentParagraphs(ai, ["吾輩は猫である。"])).toEqual([[3]]);
  });

  it("Chat Completions 形式の入力 (messages・json_schema の name と schema・推論の無効化) で問い合わせる", async () => {
    const ai = fakeAi(() => ({ response: { units: ["吾輩は", "猫である。"] } }));
    await segmentParagraphs(ai, ["吾輩は猫である。"]);
    const [model, inputs] = ai.run.mock.calls[0];
    expect(model).toBe("@cf/google/gemma-4-26b-a4b-it");
    expect(inputs).toMatchObject({
      messages: [{ role: "system" }, { role: "user", content: "吾輩は猫である。" }],
      response_format: {
        type: "json_schema",
        json_schema: { name: expect.any(String), schema: { type: "object", required: ["units"] } },
      },
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it("OpenAI 互換の choices の文字列の応答も、推論の部分とコードブロックの囲みを除いて読む", async () => {
    const ai = fakeAi(() => ({
      choices: [{ message: { content: '<think>区切る</think>\n```json\n{"units": ["名前は", "まだ無い。"]}\n```' } }],
    }));
    expect(await segmentParagraphs(ai, ["名前はまだ無い。"])).toEqual([[3]]);
  });

  it.each([
    ["文字を足した", { response: { units: ["吾輩は", "猫である。にゃん"] } }],
    ["文字を削った", { response: { units: ["吾輩は", "猫である"] } }],
    ["空の単位を含む", { response: { units: ["吾輩は", "", "猫である。"] } }],
    ["JSON でない", { response: "吾輩は / 猫である。" }],
    ["units が無い", { response: { segments: ["吾輩は", "猫である。"] } }],
  ])("%s応答は捨てて null にする", async (_, response) => {
    expect(await segmentParagraphs(fakeAi(() => response), ["吾輩は猫である。"])).toEqual([null]);
  });

  it("Workers AI の呼び出しが失敗した段落は null にし、ほかの段落の区切りは返す", async () => {
    const ai = fakeAi((paragraph) => {
      if (paragraph === "失敗する段落。") {
        throw new Error("rate limited");
      }
      return { response: { units: ["吾輩は", "猫である。"] } };
    });
    expect(await segmentParagraphs(ai, ["失敗する段落。", "吾輩は猫である。"])).toEqual([null, [3]]);
  });

  it("仮名・漢字を含まない段落と 1,000 文字を超える段落は問い合わせずに null にする", async () => {
    const ai = fakeAi((paragraph) => ({ response: { units: [paragraph] } }));
    const result = await segmentParagraphs(ai, ["Speed reading is a technique.", "あ".repeat(1_001), "吾輩は猫である。"]);
    expect(result).toEqual([null, null, []]);
    expect(ai.run).toHaveBeenCalledTimes(1);
  });

  it("31 段落目以降と、文字数の合計が 20,000 文字を超える段落は問い合わせずに null にする", async () => {
    const ai = fakeAi((paragraph) => ({ response: { units: [paragraph] } }));
    const manyParagraphs = Array.from({ length: 31 }, () => "吾輩は猫である。");
    expect((await segmentParagraphs(ai, manyParagraphs)).at(-1)).toBeNull();
    expect(ai.run).toHaveBeenCalledTimes(30);

    ai.run.mockClear();
    // 1,000 文字の段落 20 個で合計が上限に達し、21 個目は問い合わせない
    const longParagraphs = Array.from({ length: 21 }, () => "あ".repeat(1_000));
    expect((await segmentParagraphs(ai, longParagraphs)).at(-1)).toBeNull();
    expect(ai.run).toHaveBeenCalledTimes(20);
  });

  it("時間の上限までに応答が無い段落は null にし、応答があった段落の区切りは返す", async () => {
    const ai: Ai = {
      run: async (_model, inputs) => {
        const paragraph = (inputs.messages as { role: string; content: string }[])[1].content;
        return paragraph === "遅い段落。" ? new Promise(() => {}) : { response: { units: ["吾輩は", "猫である。"] } };
      },
    };
    expect(await segmentParagraphs(ai, ["遅い段落。", "吾輩は猫である。"], 50)).toEqual([null, [3]]);
  });
});
