import { describe, expect, it } from "vitest";
import { DEFAULT_NOISE_LENGTH, makeNoiseTable } from "../src/noise";
import { makeRng } from "../src/rng";

describe("makeNoiseTable", () => {
  it("is deterministic per seed, varies across seeds, and stays in [-1, 1)", () => {
    const a = makeNoiseTable(makeRng(1), 1000);
    expect(a).toEqual(makeNoiseTable(makeRng(1), 1000));
    expect(a).not.toEqual(makeNoiseTable(makeRng(2), 1000));
    expect(a.length).toBe(1000);
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
    }
  });

  it("defaults to one second at 44.1k and rejects a bad length", () => {
    expect(makeNoiseTable(makeRng(1)).length).toBe(DEFAULT_NOISE_LENGTH);
    expect(() => makeNoiseTable(makeRng(1), 0)).toThrow(RangeError);
    expect(() => makeNoiseTable(makeRng(1), 1.5)).toThrow(RangeError);
  });
});
