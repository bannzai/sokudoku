---
paths:
  - "src/**"
  - "package.json"
---
# 読み込んだ本文をブラウザの外へ出さない実装の規律

AGENTS.md「不変条件」の「本文をサーバー・外部サービスへ送らない」(根拠: `documents/adr/0001-static-export-on-github-pages.md`) を、コードで守るための規律。

- 本文の分割・表示時間の計算・翻訳の呼び出しは、I/O を持たない関数 (`src/lib/` 配下) と、ブラウザ API を呼ぶ薄い層に分ける。分割と表示時間の計算は vitest で入出力を検証する
- `fetch` / `XMLHttpRequest` / `navigator.sendBeacon` / `WebSocket` の送信内容に、本文・文節・文を含めない。ネットワークを使ってよいのは、同じオリジンの静的アセット (辞書・フォント等) の読み込みと、Cloudflare Web Analytics の beacon (ページの URL・参照元・ページ読み込みの性能指標を送る。本文・文節・文は載せない) に限る
- 本文を URL (クエリ・パス・hash) に入れない。URL はアクセス解析と配信のログに残るため
- 翻訳は Chrome の Translator API (端末内で実行) だけを使い、外部の翻訳 API・生成 AI の API を呼ばない
- 本文を扱うライブラリを依存に足す時は、外部への送信 (テレメトリ・CDN からの動的読み込み) が無いことを README・ソースで確認し、PR に書く
