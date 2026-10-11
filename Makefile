.PHONY: setup dev lint typecheck test build-web typecheck-worker test-worker check

# worker/ (URL から本文を取り出す Cloudflare Worker) は依存を別に持つため、両方を導入する
setup:
	npm ci
	npm ci --prefix worker

# basePath が /sokudoku のため http://localhost:3000/sokudoku/ を開く
dev:
	npm run dev

lint:
	npm run lint

# next build が生成する next-env.d.ts を型検査で参照するため、CI では build-web の後に実行する
typecheck:
	npm run typecheck

test:
	npm test

build-web:
	npm run build

typecheck-worker:
	npm --prefix worker run typecheck

test-worker:
	npm --prefix worker test

check: lint build-web typecheck test typecheck-worker test-worker

# 引数なしの make で web を実行する (人が手で動作確認するための入口。検査・テストは CI が行う)
.DEFAULT_GOAL := web

.PHONY: verify
verify: check

# ブラウザで開く URL とサーバーの待ち受けを一致させるため、ポートを -p で明示する (next dev は明示したポートが使用中なら別のポートへ逃げず失敗する)。
# 既定の 3000 は next dev の既定ポートで、dev の案内 (AGENTS.md) と Worker の CORS 許可元 (ADR 0004) が同じ値を前提にしている。
# WEB_PORT=3001 make で変えられるが、Worker の CORS 許可元は 3000 だけのため、別のポートでは URL からの取り込みがブラウザに拒否される。
# 変数名は、ほかのツール向けにシェルへ設定されがちな PORT を意図せず拾わないよう、このリポジトリ専用の名前にする
WEB_PORT ?= 3000

.PHONY: web
# 人が手で動作確認するための入口。サーバーが前面で動くため、ブラウザを開く処理は背面に置く。
# 固定時間の待機だと起動の遅い環境で待ち受け前に開いて接続エラーになるため、応答を確かめてから開く。
# 上限の 60 秒は、next dev の初回起動が数秒で終わることへの十分な余裕で、超えたら起動失敗とみなして開かない。
# 応答の確認は今回起動したサーバーのものである必要があるため、先にポートが空いていることを確かめ、使用中 (別の worktree のサーバー等) なら起動せずに失敗する。
# サーバーが終わった後 (起動の失敗・Ctrl-C 等) に背面の待機が残ると、その間にポートを使い始めた別のプロセスを開きかねないため、
# シェルの終了時 (Ctrl-C の SIGINT を含む。背面のジョブは SIGINT を無視するため trap で止める) に待機を止める
web:
	@if lsof -nP -iTCP:$(WEB_PORT) -sTCP:LISTEN >/dev/null; then echo "ポート $(WEB_PORT) は使用中です。WEB_PORT=<別のポート> make で指定してください" >&2; exit 1; fi
	(for i in $$(seq 1 60); do curl -fs -o /dev/null http://localhost:$(WEB_PORT)/sokudoku/ && { open http://localhost:$(WEB_PORT)/sokudoku/; break; }; sleep 1; done) & waiter=$$!; trap 'kill $$waiter 2>/dev/null' EXIT; trap 'exit 130' INT TERM; npm run dev -- -p $(WEB_PORT)
