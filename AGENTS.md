# AGENTS.md

日本語・英語の文章を 1 語 (日本語は文節) ずつ同じ位置へ表示して速く読む RSVP 速読リーダー。機能は `documents/PROJECT.md`、仮説・判定基準・決めたことは `documents/DIRECTION.md`、技術方針は `documents/adr/0001-static-export-on-github-pages.md`、特許・権利上の制約は `documents/adr/0002-avoid-patented-features-and-drm-import.md` を正とする。

main へのマージで `deploy.yml` が https://bannzai.github.io/sokudoku/ へ自動配布する。

## 不変条件

- 読み込んだ本文をサーバー・外部サービスへ送らない、保存しない。処理はすべてブラウザ内で行う (ADR 0001)
  - 例外: URL からの取り込みだけは、ページの URL を `worker/` の Cloudflare Worker へ送り、Worker が公開ページの取得と本文の抽出を行う。Worker は URL・本文を保存・記録しない (ADR 0004)
- 文節 (単語) は中央揃えで表示する。ORP を定位置に揃える配置・特定の 1 文字の色付け・文節の中の文字を位置で変える見た目を作らない (ADR 0002)
- 再生中に全文を出さない。全文と現在位置のハイライトは停止中だけ出す。本・記事の一覧を表示したまま再生しない (ADR 0002)
- 固有名詞・人物名で表示時間を延ばさない。間をとるのは句読点だけにする (ADR 0002)
- 理解度クイズ・訓練コース・視線/カメラ/生体情報・読み上げ音声との連動・DRM 付き書籍の取り込みを作らない (ADR 0002)

## 検証方法

ビルド・テスト・ブラウザでの動作確認は外部マシンに任せ、このマシン (ローカル Mac) の負荷を避ける。本リポジトリは public のため GitHub Actions の Linux runner を使う (private に変える場合は Devin のセッションに移す)。

| 対象 | 方法 |
| --- | --- |
| lint / 型検査 / テスト / ビルド | PR の `ci.yml` の結果で確認する (`make check` と同じコマンド)。ローカルでは CI の失敗を再現・修正する時だけ `make setup` → `make check` を実行する |
| ブラウザでの動作確認 | webtunnel skill (`~/.claude/skills/webtunnel/SKILL.md`) で、GitHub Actions runner 上の Chromium と dev サーバ (`browser-session.yml`) を開く。`WEBTUNNEL_REPO=bannzai/sokudoku` と `--ref <ブランチ>` で PR のコードを開き、dev サーバの URL は http://127.0.0.1:3000/sokudoku/ 。UI の変更はスクリーンショットを Read して目視確認してから完了報告する (HTTP 200 やビルド成功で表示を判断しない)。ローカルの agent-browser は runner から再現できない時だけ使い、理由を PR に書く |
| 公開後の確認 | https://bannzai.github.io/sokudoku/ を webtunnel のセッションで開く |
| 公開後の利用状況の分析 | `/cloudflare-web-analytics-report` (設定は `.claude/cloudflare-web-analytics.json`) で Cloudflare Web Analytics の日別の訪問数・人気ページを読む |

`make` の target: `setup` (依存の導入) / `dev` (http://localhost:3000/sokudoku/) / `lint` / `typecheck` / `test` / `build-web` (`out/` へ静的書き出し) / `typecheck-worker`・`test-worker` (`worker/` の Worker) / `check` (lint・typecheck・test・build-web・typecheck-worker・test-worker)

`worker/` の Worker は `wrangler dev` をローカルで起動せず、vitest の単体テストと、main へのマージで `deploy-worker.yml` が行う配信で確かめる。

<!-- ai-review-config begin -->
<!--
このブロックは自動生成です。直接編集せず、テンプレートを更新してから再生成してください。
内容は AI コードレビュー時の挙動指示であり、コードベース自体への規約ではありません。
-->

## レビュー時の応答スタイル

- 応答は日本語で行う

## レビュー範囲外

以下は自動レビューで指摘しない (別の検出経路があるため):

- コンパイルエラー・型エラー (ローカル/CI のビルドで検出される)
- Lint/フォーマット違反 (リンター・フォーマッターで検出される)
<!-- ai-review-config end -->
