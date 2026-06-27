import { defineConfig } from "tsup";

// Two outputs from one source:
//  1. ESM + .d.ts for the two entry points (`@simpllyf/ditty` and
//     `@simpllyf/ditty/core`). Unminified — consumers' bundlers minify.
//  2. A self-contained, minified IIFE global (`window.Ditty`) for dropping into
//     a plain HTML file via <script>, no build step (acceptance criterion §14.3).
export default defineConfig([
  {
    entry: ["src/index.ts", "src/core.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    treeshake: true,
    sourcemap: true,
    target: "es2022",
  },
  {
    entry: { ditty: "src/index.ts" },
    format: ["iife"],
    globalName: "Ditty",
    minify: true,
    sourcemap: true,
    target: "es2022",
  },
]);
