import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The pure brain and the audio shell (against a fake AudioContext) both run
    // headless in Node — no real audio, no DOM. Browser coverage lives in the
    // Playwright e2e suite, which is not run by vitest.
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
