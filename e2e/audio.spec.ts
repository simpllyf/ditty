import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import "./types"; // brings the `window.ditty` global into scope

const harnessBundle = fileURLToPath(new URL("./harness.bundle.js", import.meta.url));
const shippedGlobal = fileURLToPath(new URL("../dist/ditty.global.js", import.meta.url));

test.beforeEach(async ({ page }) => {
  await page.goto("about:blank");
  await page.addScriptTag({ path: harnessBundle });
  await page.waitForFunction(() => Boolean(window.ditty));
});

test("produces audible, finite audio through real Web Audio", async ({ page }) => {
  const result = await page.evaluate(() => window.ditty.renderOffline(42, 1.5));
  expect(result.length).toBeGreaterThan(0);
  expect(result.peak).toBeGreaterThan(0.01); // not silence
  expect(Number.isFinite(result.peak)).toBe(true); // no NaN/Infinity garbage
  expect(result.peak).toBeLessThan(4); // sane bound (the engine has no limiter, but isn't runaway)
  expect(result.rms).toBeGreaterThan(0); // real energy, not a single blip
});

test("renders deterministically per seed and differently across seeds", async ({ page }) => {
  const a = await page.evaluate(() => window.ditty.renderOffline(42, 1));
  const b = await page.evaluate(() => window.ditty.renderOffline(42, 1));
  const other = await page.evaluate(() => window.ditty.renderOffline(7, 1));

  // Real-browser audio DSP is NOT bit-reproducible (WebKit reorders/denormalizes),
  // so two renders of the SAME seed differ by ~1 ULP. Assert determinism with a
  // tolerance, never exact float equality; a different seed must differ far more.
  const maxAbsDiff = (x: number[], y: number[]): number => {
    expect(x.length).toBe(y.length);
    let m = 0;
    for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]! - y[i]!));
    return m;
  };
  expect(maxAbsDiff(a.samples, b.samples)).toBeLessThan(1e-3); // same seed → identical within float noise
  expect(maxAbsDiff(a.samples, other.samples)).toBeGreaterThan(1e-2); // different seed → audibly different
});

// Realtime audio (a live AudioContext clock) is reliable headless in Chromium;
// the offline render above is the cross-browser proof of real sound.
test("the full engine resumes and runs from a user gesture", async ({ page, browserName }) => {
  test.skip(
    browserName !== "chromium",
    "realtime AudioContext clock is flaky headless off Chromium",
  );

  // Listen before the gesture so startup-path errors (resume, first tick,
  // synth.play) are caught, not just steady-state ones.
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.click("#ditty-start"); // a genuine gesture → engine.start() → resume()
  await page.waitForFunction(() => window.ditty.engineState() === "running", undefined, {
    timeout: 5000,
  });
  await page.waitForFunction(() => window.ditty.engineTime() > 0, undefined, { timeout: 5000 });
  await page.waitForTimeout(200);
  expect(errors).toEqual([]); // no errors across startup or steady-state playback
});

test("the shipped IIFE global works in a plain page with no build step", async ({ page }) => {
  await page.goto("about:blank");
  await page.addScriptTag({ path: shippedGlobal });
  const result = await page.evaluate(() => {
    if (typeof window.Ditty?.createEngine !== "function") return "no factory";
    const engine = window.Ditty.createEngine({ seed: 1 });
    return typeof engine.start === "function" ? "ok" : "bad engine";
  });
  expect(result).toBe("ok");
});
