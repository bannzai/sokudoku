import { Reader } from "@/components/Reader";

/** トップページのリーダー画面。本文の取り込み・再生・読了はすべてブラウザ内で行う (ADR 0001)。 */
export default function HomePage() {
  return <Reader />;
}
