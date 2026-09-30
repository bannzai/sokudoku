import type { Metadata } from "next";
// layout.test.tsx が vitest で読み込み、vitest は tsconfig の paths (@/) を解決しないため相対で import する
import { siteUrl } from "../lib/site";
import { CloudflareWebAnalyticsBeacon } from "./CloudflareWebAnalyticsBeacon";
import "./globals.css";

// og:title・og:description は各ページの title・description から引き継がせるため、ここでは画像とサイト名だけを置く
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "sokudoku",
  description: "日本語・英語の文章を 1 語ずつ同じ位置へ表示して速く読む RSVP 速読リーダー",
  openGraph: {
    type: "website",
    siteName: "sokudoku",
    locale: "ja_JP",
    // 先頭に / を付けると metadataBase の /sokudoku/ が外れてオリジン直下を指すため相対で書く
    images: [{ url: "og.png", width: 1200, height: 630, alt: "sokudoku 日本語と英語を 1 語ずつ読む RSVP 速読リーダー" }],
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        {children}
        <CloudflareWebAnalyticsBeacon />
      </body>
    </html>
  );
}
