import { MaintenanceResolver } from "@/components/MaintenanceResolver";
import { Reader } from "@/components/Reader";

/** トップページのリーダー画面。本文の取り込み・再生・読了はすべてブラウザ内で行う (ADR 0001)。メンテナンス中はリーダーを作らずメンテナンス中の画面だけを出す。 */
export default function HomePage() {
  return (
    <MaintenanceResolver>
      <Reader />
    </MaintenanceResolver>
  );
}
