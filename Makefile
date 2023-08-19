.PHONY: \
	install \
	build \
	release \
	dev

build:
	pnpm package

release:
	pnpm build:vsce

install:
	pnpm install

dev:
	pnpm watch