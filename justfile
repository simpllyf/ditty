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

# Run the tests with V8 coverage + enforced thresholds (used by `check`).
coverage:
    pnpm exec vitest run --coverage

build:
    pnpm exec tsup

# Fail if the package ever grows a runtime dependency (spec §12).
deps-check:
    node scripts/check-no-deps.mjs

# Assert the full engine stays under its gzipped size budget (spec §12).
size:
    DITTY_SIZE_MAX_GZIP_BYTES=10240 node scripts/measure-size.mjs

# Build the browser-side harness the e2e suite injects.
e2e-build:
    node scripts/build-e2e.mjs

# Cross-browser audio e2e (needs Playwright browsers: `pnpm exec playwright install`).
# Builds dist too so the suite can also exercise the shipped IIFE global.
e2e: build e2e-build
    pnpm exec playwright test

# The single gate CI runs (browserless). e2e runs in its own CI job.
check: format-check lint typecheck coverage build deps-check size
