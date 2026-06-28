// Assemble the static site's engine bundle into site/lib/ (gitignored).
// Run after `tsup` (which emits the ESM build into dist/). The landing page imports
// ./lib/index.js + ./lib/core.js relatively, so the playground always reflects the
// current branch — no published npm version needed. Used by `pnpm build:site` /
// `just site` locally and by the Cloudflare Pages build command in production.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const OUT = join("site", "lib");

if (!existsSync(join(DIST, "index.js"))) {
  console.error("build-site: dist/index.js missing — run `tsup` first.");
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The ESM entries + their shared chunk(s); skip the IIFE global and sourcemaps.
const keep = (f) => f.endsWith(".js") && f !== "ditty.global.js" && !f.endsWith(".map");
let n = 0;
for (const file of readdirSync(DIST)) {
  if (keep(file)) {
    copyFileSync(join(DIST, file), join(OUT, file));
    n++;
  }
}
console.log(`build-site → ${OUT} (${n} files)`);
