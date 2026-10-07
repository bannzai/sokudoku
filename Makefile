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

.PHONY: web
# dev と同じサーバーを起動し、basePath /sokudoku のトップをブラウザで開く。サーバーが前面で動くため、ブラウザは背面で少し待ってから開く
web:
	(sleep 2 && open http://localhost:3000/sokudoku/) &
	npm run dev
