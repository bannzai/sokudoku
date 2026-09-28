# 0001. Next.js の静的書き出しを GitHub Pages で配信し、本文をブラウザ内だけで処理する

## Status
Accepted

## Context
- ユーザーが読み込む文章には、著作権のある書籍・記事が含まれうる。IdeaMemo #341 の追加調査「Kindle の個人利用・Spritz の米国特許・X の投稿の再現」で、本文をブラウザ内だけで処理しサーバーに保存しない方針を決めた。文節の分割と配置をブラウザ内で完結させると、US 8,903,174 の請求項 19・47 からも遠くなる
- 立ち上げ時 (2026-09-28) にユーザーが、ホスティングを GitHub Pages のみ (github.io、独自ドメインなし) に決めた。ドメイン取得や配信先の Secrets 登録といったユーザー作業を持たないため
- サーバーで処理するものが無いので、SSR・API Routes・DB・認証は要らない

## Decision
- Next.js を `output: "export"` で静的書き出しし、GitHub Actions (`.github/workflows/deploy.yml`) で GitHub Pages のプロジェクトサイト https://bannzai.github.io/sokudoku/ へ配信する。`basePath` は `/sokudoku`
- 文節の分割・表示・翻訳を含むすべての本文の処理をブラウザ内で行う。本文を送る先のサーバーを作らない
- 設定と読書位置はブラウザのストレージに保存する。DB は持たない
- アクセス解析は Cloudflare Web Analytics の手動 beacon にする (Cookie を使わない。Cloudflare 以外の配信先でも script タグで計測できる)
- LP・利用規約・プライバシーポリシーはアプリ内のページにする (1 リポジトリにつき Pages のサイトは 1 つで、`docs/` を別サイトとして配信できないため)。法務ドキュメントの原文は `content/legal/*.md` に置き、ビルド時に HTML にする
- 課金は持たない

## Consequences
- 配信・運用の費用とユーザー作業が無い。main へのマージで自動配布される
- 独自ドメインが無いため、Google Search Console のドメインプロパティは作れない (URL プレフィックスのプロパティは作れる)。独自ドメインへ移る時は `basePath` の変更、法務ページの URL の周知、Search Console の登録が要る
- サーバーを持たないので、問い合わせフォームは作らずメール (bannzai.app@gmail.com) で受ける
- 日本語の文節分割の辞書・モデルもブラウザへ配信することになり、バンドルサイズが読み込み時間に効く。分割方式を決める issue で扱う
