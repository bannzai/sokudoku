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
