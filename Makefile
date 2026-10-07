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
# dev と同じサーバーを起動し、basePath /sokudoku のトップをブラウザで開く。サーバーが前面で動くため、ブラウザは背面で少し待ってから開く
web:
	(sleep 2 && open http://localhost:$(PORT)/sokudoku/) &
	npm run dev -- -p $(PORT)
