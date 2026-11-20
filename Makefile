.PHONY: build clean install dev test

build: install
	pnpm run build

install:
	pnpm i

test: install
	pnpm run test

dev: install
	pnpm run dev

clean:
	rm -rf node_modules
