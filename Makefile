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
# 既定の 3000 は next dev の既定ポートで、dev の案内 (AGENTS.md) と Worker の CORS 許可元 (ADR 0004) が同じ値を前提にしている。PORT=3001 make で変えられる
PORT ?= 3000

.PHONY: web
# 人が手で動作確認するための入口。サーバーが前面で動くため、ブラウザを開く処理は背面に置く。
# 固定時間の待機だと起動の遅い環境で待ち受け前に開いて接続エラーになるため、応答を確かめてから開く。
# 上限の 60 秒は、next dev の初回起動が数秒で終わることへの十分な余裕で、超えたら起動失敗とみなして開かない
web:
	(for i in $$(seq 1 60); do curl -fs -o /dev/null http://localhost:$(PORT)/sokudoku/ && { open http://localhost:$(PORT)/sokudoku/; break; }; sleep 1; done) &
	npm run dev -- -p $(PORT)
