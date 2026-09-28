import type { NextConfig } from "next";

// 本文をブラウザ内だけで処理するためサーバーの実行環境を持たず、静的書き出しを GitHub Pages の
// プロジェクトサイト (https://bannzai.github.io/sokudoku/) で配信する (documents/adr/0001-static-export-on-github-pages.md)
const nextConfig: NextConfig = {
  output: "export",
  basePath: "/sokudoku",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
