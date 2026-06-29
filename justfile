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

# Build the landing-page engine bundle into site/lib/ (gitignored). Serve `site/`.
site: build
    node scripts/build-site.mjs

# Fail if the package ever grows a runtime dependency (spec §12).
deps-check:
    node scripts/check-no-deps.mjs

# Track the gzipped engine size. Soft cap at 1 MB (a generous ceiling) — the number
# is informational; we watch the trend rather than fail on a tight byte budget.
size:
    DITTY_SIZE_MAX_GZIP_BYTES=1048576 node scripts/measure-size.mjs

# Build the browser-side harness the e2e suite injects.
e2e-build:
    node scripts/build-e2e.mjs

# Cross-browser audio e2e (needs Playwright browsers: `pnpm exec playwright install`).
# Builds dist too so the suite can also exercise the shipped IIFE global.
e2e: build e2e-build
    pnpm exec playwright test

# The single gate CI runs (browserless). e2e runs in its own CI job.
check: format-check lint typecheck coverage build deps-check size

# Merging the PR creates the v<version> tag (tag.yml); then dispatch the release
# workflow from that tag to publish to npm.
# Open a version-bump PR. Usage: just release 0.1.0
release new_version:
    #!/usr/bin/env bash
    set -euo pipefail
    pnpm version "{{new_version}}" --no-git-tag-version
    pnpm exec prettier --write package.json
    git checkout -b "release/v{{new_version}}"
    git add package.json
    git commit -m "release: v{{new_version}}"
    git push -u origin "release/v{{new_version}}"
    gh pr create --title "release: v{{new_version}}" \
      --body "Bump version to {{new_version}}. Merging this tags v{{new_version}}; then dispatch the release workflow from that tag to publish to npm."
    echo "Release PR opened for v{{new_version}}"
