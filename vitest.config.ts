import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The pure brain and the audio shell (against a fake AudioContext) both run
    // headless in Node — no real audio, no DOM. Browser coverage lives in the
    // Playwright e2e suite, which is not run by vitest.
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Golden snapshots live under test/golden/ (spec §13) — the deterministic
    // safety net for the musical brain.
    resolveSnapshotPath: (testPath, snapExtension) =>
      path.join(path.dirname(testPath), "golden", path.basename(testPath) + snapExtension),
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // index.ts / core.ts are pure re-export barrels (no logic); voices.ts is types only.
      exclude: ["src/index.ts", "src/core.ts", "src/voices.ts"],
      reporter: ["text", "html"],
      // High bar with a little headroom; defensive FP/SSR paths carry c8-ignore.
      thresholds: {
        statements: 96,
        branches: 90,
        functions: 90,
        lines: 97,
      },
    },
  },
});
