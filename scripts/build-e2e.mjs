// Bundles the browser-side e2e harness (e2e/harness.ts → e2e/harness.bundle.js)
// so Playwright can inject it into the page. Pulls the real engine graph from
// src. Not shipped; the output is git-ignored.
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

await build({
  entryPoints: [fileURLToPath(new URL("../e2e/harness.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("../e2e/harness.bundle.js", import.meta.url)),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
});

process.stdout.write("built e2e harness → e2e/harness.bundle.js\n");
