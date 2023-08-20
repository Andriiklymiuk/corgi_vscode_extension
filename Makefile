.PHONY: \
	install \
	build \
	buildRelease \
	dev \
	publish

build:
	pnpm package

buildRelease:
	pnpm build:vsce

install:
	pnpm install

dev:
	pnpm watch

publish:
	pnpm publish:vsce