# 0004. URL からの取り込みだけは、取得と本文の抽出を行う Cloudflare Worker を通す

## Status
Accepted

## Context
- URL を貼ると、そのページの本文を取り出してリーダーで読めるようにしたい (bannzai の発言 2026-10-05「URL を貼ったら本文を抽出して読み上げてくれる機能がほしい」。issue #27・#28)
- GitHub Pages のページから他サイトを直接 `fetch` すると、相手サイトが CORS を許可していない限り本文を読めない。ブラウザだけでは実現できないため、bannzai が Cloudflare Worker を用意すると決めた (2026-10-05「Cloudflare Worker を用意しちゃおうか」)
- ADR 0001 は「本文を送る先のサーバーを作らない」と決めている。その理由は、ユーザーが用意した文章 (著作権のある書籍・記事を含む) を提供者が受け取らないことにある

## Decision
- URL からの取り込みに限り、取得と本文の抽出だけを行う Cloudflare Worker (`worker/`、`https://sokudoku-extract.<account の workers.dev サブドメイン>.workers.dev`) を通す。フロントは `GET /extract?url=<URL>` を呼び、返ってきた本文 `{ title, text, siteName?, lang? }` を貼り付けと同じ経路で取り込む
- Worker が受け取るのはページの URL だけで、ユーザーが貼り付けた本文・読み込んだファイルの本文は従来どおりブラウザから出さない。Worker が扱う本文は、URL の先にある公開ページの本文に限る
- Worker は取得した URL・本文を保存しない。ログ (Workers Logs・invocation のログ) を `wrangler.toml` で無効にし、`console.log` を書かず、取得には `cache: "no-store"` を使ってキャッシュにも残さない。回数の制限 (同じ IP から 1 分あたり 30 回) の key に IP を使うが、記録はしない
- 相手サイトの `robots.txt` (RFC 9309) を取得の前に確かめ、`sokudoku-extract` か `*` のグループの `Disallow` に当たるページは取得しない。`robots.txt` が 5xx・接続の失敗なら取得しない。User-Agent は `sokudoku-extract/1.0 (+https://bannzai.github.io/sokudoku/)` と名乗る
- ログインが必要なページ・有料のページは取得しない (Worker は Cookie・認証情報を送らないため、取得できるのは誰でも見られるページだけ)
- 取得先は http / https の公開のアドレスに限り、localhost・`.local` 等の内部向けの名前とプライベート・ループバック・リンクローカルの IP アドレスを、リダイレクトの転送先も含めて拒否する (SSRF 対策)
- CORS は `https://bannzai.github.io` と `http://localhost:3000` (make dev) だけに許可する
- Worker の URL はフロントのビルド時の環境変数 `NEXT_PUBLIC_EXTRACT_URL` (repository variable) で渡し、未設定のビルドでは URL の入口を出さない

## Consequences
- 不変条件「読み込んだ本文をサーバー・外部サービスへ送らない」に、URL からの取り込みの例外 (この ADR) が付く。例外の内容はプライバシーポリシーの「URL からの取り込み」に書く
- Cloudflare Workers の配信に、GitHub Secrets の `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit) と `CLOUDFLARE_ACCOUNT_ID` の登録というユーザー作業が要る。未登録の間は `deploy-worker.yml` が配信を飛ばす
- Workers の Free プランは 1 リクエストの CPU 時間が 10 ms まで (https://developers.cloudflare.com/workers/platform/limits/ )。2026-10-05 に手元の Node.js で計った本文の抽出の CPU 時間は、英語版 Wikipedia の「Rapid serial visual presentation」(98 KB) で 23 ms、日本語版の「速読術」(198 KB) で 115 ms で、Free プランでは多くのページが上限を超えて失敗しうる。Paid プラン (CPU 時間の既定の上限 30 秒) に上げるかは、配信後の失敗の具合を見て bannzai が決める
- 名前解決の結果 (DNS rebinding) までは確かめない。Worker は Cloudflare のエッジから取得するため、利用者・提供者の内部ネットワークには届かない
- Readability が記事と判定しないページ (一覧・トップページ・JavaScript で本文を描くページ) は取り込めない
