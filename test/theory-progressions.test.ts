import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FUNCTION_OF, PROGRESSIONS, functionalProgression } from "../src/theory/progressions";
import { makeRng } from "../src/rng";

describe("PROGRESSIONS library", () => {
  it.each(Object.entries(PROGRESSIONS))("%s uses only diatonic degrees 0..6", (_, prog) => {
    expect(prog.length).toBeGreaterThan(0);
    for (const d of prog) {
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(6);
    }
  });
});

describe("FUNCTION_OF", () => {
  it("maps every degree to its harmonic function", () => {
    // Full map pinned so a relabel can't pass the self-consistent transition test.
    expect(FUNCTION_OF).toEqual({ 0: "T", 1: "S", 2: "T", 3: "S", 4: "D", 5: "T", 6: "D" });
  });
});

describe("functionalProgression", () => {
  it("is deterministic, the right length, opens on the tonic, stays in 0..6", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 1, max: 32 }), (seed, length) => {
        const a = functionalProgression(makeRng(seed), length);
        const b = functionalProgression(makeRng(seed), length);
        expect(a).toEqual(b); // deterministic
        expect(a).toHaveLength(length);
        expect(a[0]).toBe(0); // opens on I
        for (const d of a) {
          expect(d).toBeGreaterThanOrEqual(0);
          expect(d).toBeLessThanOrEqual(6);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("only makes legal function-to-function moves", () => {
    const legal: Record<string, Set<string>> = {
      T: new Set(["S", "D"]),
      S: new Set(["D", "T", "S"]),
      D: new Set(["T", "D"]),
    };
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const degrees = functionalProgression(makeRng(seed), 16);
        for (let i = 1; i < degrees.length; i++) {
          const from = FUNCTION_OF[degrees[i - 1]!]!;
          const to = FUNCTION_OF[degrees[i]!]!;
          expect(legal[from]!.has(to)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("produces variety across seeds", () => {
    expect(functionalProgression(makeRng(1), 16)).not.toEqual(
      functionalProgression(makeRng(2), 16),
    );
  });

  it("rejects an invalid length", () => {
    expect(() => functionalProgression(makeRng(1), 0)).toThrow(RangeError);
    expect(() => functionalProgression(makeRng(1), 2.5)).toThrow(RangeError);
  });
});
