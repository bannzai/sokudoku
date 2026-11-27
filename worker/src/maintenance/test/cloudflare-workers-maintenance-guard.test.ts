import { assert, test } from "vitest";

import { maintenanceResponse } from "../cloudflare-workers-maintenance-guard";
import { fetchFailing, fetchReturning, IN_MAINTENANCE_WITH_BUTTON_JSON, NOT_IN_MAINTENANCE_JSON, readerWith } from "./support/fixtures";

/** 入口で maintenanceResponse を待ってから費用のかかる処理を呼ぶ、Cloudflare Workers のハンドラーの形 */
async function workersHandler(readMaintenanceState: ReturnType<typeof readerWith>, costlyCall: () => void): Promise<Response> {
  const blocked = await maintenanceResponse(readMaintenanceState);
  if (blocked !== null) return blocked;
  costlyCall();
  return new Response("generated");
}

test("メンテナンス中は 503 で断り、費用のかかる処理を呼ばない", async () => {
  let costlyCallCount = 0;
  const response = await workersHandler(readerWith(fetchReturning(IN_MAINTENANCE_WITH_BUTTON_JSON).fetchImpl), () => {
    costlyCallCount += 1;
  });
  assert.strictEqual(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "maintenance",
    maintenance: {
      maintenance: true,
      message: "復旧までお待ちください",
      button: { label: "お知らせを見る", url: "https://example.com/news" },
      source: "owner",
      changedAt: "2026-11-25T07:00:00.000Z",
    },
  });
  assert.strictEqual(costlyCallCount, 0);
});

test("メンテナンス中でなければ処理を通す", async () => {
  let costlyCallCount = 0;
  const response = await workersHandler(readerWith(fetchReturning(NOT_IN_MAINTENANCE_JSON).fetchImpl), () => {
    costlyCallCount += 1;
  });
  assert.strictEqual(response.status, 200);
  assert.strictEqual(await response.text(), "generated");
  assert.strictEqual(costlyCallCount, 1);
});

test("状態を読めない時 (通信の失敗・状態を返す Worker の 500) は処理を通す", async () => {
  for (const fetchImpl of [fetchFailing, fetchReturning({ error: "failed to read state" }, 500).fetchImpl]) {
    let costlyCallCount = 0;
    assert.strictEqual(
      (
        await workersHandler(readerWith(fetchImpl), () => {
          costlyCallCount += 1;
        })
      ).status,
      200,
    );
    assert.strictEqual(costlyCallCount, 1);
  }
});
