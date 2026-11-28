import type { MaintenanceState } from "./maintenance-state";

/**
 * メンテナンス中なら、処理を断る 503 の応答 (body の maintenance に状態を入れた JSON) を返し、そうでなければ null を返す。
 * 費用のかかる処理 (外部の API の呼び出し等) の前で await し、null でなければその応答をそのまま返す。
 * readMaintenanceState には、モジュールの先頭で 1 度だけ `createMaintenanceReader({ stateURL, shareConcurrentReads: false })` で作った読み手を渡す
 * (リクエストごとに作ると読んだ状態を覚えない。shareConcurrentReads を false にする理由は MaintenanceReaderOptions の同名の項目)。
 * 状態を読めなかった時は readMaintenanceState が NOT_IN_MAINTENANCE を返すため、null を返す
 */
export async function maintenanceResponse(readMaintenanceState: () => Promise<MaintenanceState>): Promise<Response | null> {
  const state = await readMaintenanceState();
  return state.maintenance ? Response.json({ error: "maintenance", maintenance: state }, { status: 503 }) : null;
}
