import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "sokudoku",
  description: "日本語・英語の文章を 1 語ずつ同じ位置へ表示して速く読む RSVP 速読リーダー",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
