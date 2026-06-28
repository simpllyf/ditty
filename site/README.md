# site — dittyjs.dev landing page

A self-contained static landing page with a live playground that runs the **real
engine** in the browser.

## How the engine is loaded

`index.html` imports the engine from `./lib/*.js`. That `lib/` directory is **built,
not committed** (it's in `.gitignore`) — so nothing compiled lives in git, and the
playground always reflects the current source.

- **Build it:** `just site` (or `pnpm build:site`) → compiles `src/` and copies the
  ESM build into `site/lib/`.
- **Post-publish option:** once `@simpllyf/ditty` is on npm, swap the two `import`
  lines at the top of `index.html`'s module script to a CDN
  (`https://esm.sh/@simpllyf/ditty`) to auto-track the released version with no build.

## Local preview

```sh
just site                                  # build the engine into site/lib/
python3 -m http.server 8099 --directory site
# open http://localhost:8099  (must be HTTP, not file:// — ES modules need it)
```

## Deploy (Cloudflare Pages)

Connect the GitHub repo and set:

- **Build command:** `corepack enable && pnpm install --frozen-lockfile && pnpm build:site`
- **Output directory:** `site`

CF clones the repo (no `site/lib/`), runs the build to produce it, and serves `site/`.
