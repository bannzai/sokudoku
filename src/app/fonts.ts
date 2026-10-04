import { BIZ_UDPGothic, BIZ_UDPMincho, Literata } from "next/font/google";

// フォントは next/font がビルド時に取得して同じオリジンから配信する。ブラウザから Google Fonts へは接続しない (ADR 0001)。
// BIZ UDP の 2 書体は日本語の字形を Google Fonts の unicode-range の分割ファイルで配るため、先読みする subset が無く preload を切る

const bizUdpGothic = BIZ_UDPGothic({
  weight: ["400", "700"],
  display: "swap",
  preload: false,
  variable: "--font-biz-udpgothic",
});

// 文節の表示と全文は通常の太さだけで出すため 400 だけを取る
const bizUdpMincho = BIZ_UDPMincho({
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--font-biz-udpmincho",
});

// 可変フォント。見出しの大きい字と本文の小さい字で字形を変える opsz 軸を使う
const literata = Literata({
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-literata",
});

/** 3 書体の CSS 変数を定義する class 名。html 要素に付け、globals.css の書体のトークンから参照する。 */
export const fontVariableClassNames = [bizUdpGothic.variable, bizUdpMincho.variable, literata.variable].join(" ");
