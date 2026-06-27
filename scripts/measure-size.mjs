// Measures the gzipped weight of the full engine — exactly what a consumer pays
// when they `import { createPeppyEngine } from "@simpllyf/ditty"`. Bundles the
// real `src/index.ts` graph with esbuild (minified, tree-shaken), then gzips it.
// Self-contained: no prior `tsup` build needed. esbuild is the only dev-only
// tool involved; gzip comes from node:zlib. Budget: < 10 KB (spec §12, §14.8).
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));

const result = await build({
  entryPoints: [entry],
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  legalComments: "none",
  write: false,
});

const output = result.outputFiles[0];
if (!output) {
  throw new Error("esbuild produced no output");
}

const minified = output.contents;
const gzipped = gzipSync(minified);
const kb = (bytes) => (bytes / 1024).toFixed(2);

process.stdout.write(
  `@simpllyf/ditty full engine\n` +
    `  minified: ${minified.byteLength} bytes (${kb(minified.byteLength)} kB)\n` +
    `  gzipped:  ${gzipped.byteLength} bytes (${kb(gzipped.byteLength)} kB)\n`,
);

const maxRaw = process.env.DITTY_SIZE_MAX_GZIP_BYTES;
if (maxRaw) {
  const max = Number(maxRaw);
  if (!Number.isFinite(max) || max <= 0) {
    throw new Error(`DITTY_SIZE_MAX_GZIP_BYTES is not a positive number: ${maxRaw}`);
  }
  if (gzipped.byteLength > max) {
    process.stderr.write(
      `size budget exceeded: gzipped ${gzipped.byteLength} bytes > ${max} bytes ` +
        `(${kb(gzipped.byteLength)} kB > ${kb(max)} kB)\n`,
    );
    process.exit(1);
  }
}
