set shell := ["bash", "-uc"]

default: check

# Install with the committed lockfile (CI and fresh clones).
setup:
    pnpm install --frozen-lockfile

format:
    pnpm exec prettier --write .

format-check:
    pnpm exec prettier --check .

lint:
    pnpm exec eslint .

typecheck:
    pnpm exec tsc -p tsconfig.json --noEmit

test:
    pnpm exec vitest run

build:
    pnpm exec tsup

# Fail if the package ever grows a runtime dependency (spec §12).
deps-check:
    node scripts/check-no-deps.mjs

# Assert the full engine stays under its gzipped size budget (spec §12).
size:
    DITTY_SIZE_MAX_GZIP_BYTES=10240 node scripts/measure-size.mjs

# The single gate CI runs. Mirrors what you should run before pushing.
check: format-check lint typecheck test build deps-check size
