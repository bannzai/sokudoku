import { MaintenanceGate } from "@/components/MaintenanceGate";
import { Reader } from "@/components/Reader";

/** トップページのリーダー画面。本文の取り込み・再生・読了はすべてブラウザ内で行う (ADR 0001)。メンテナンス中はリーダーの代わりにメンテナンス中の画面を出す。 */
export default function HomePage() {
  return (
    <MaintenanceGate>
      <Reader />
    </MaintenanceGate>
  );
}
