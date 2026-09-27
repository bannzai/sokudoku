.PHONY: setup dev lint typecheck test build-web check

setup:
	npm ci

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

check: lint build-web typecheck test
