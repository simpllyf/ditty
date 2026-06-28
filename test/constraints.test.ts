import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_LEAP,
  ShuffleBag,
  capLeap,
  contourTarget,
  exceedsRepeatLimit,
  isStableDegree,
  isWithinLeap,
  nearestStableDegree,
} from "../src/constraints";
import { makeRng } from "../src/rng";
import { SCALES } from "../src/theory/scales";

describe("leap cap", () => {
  it("accepts steps within the cap and rejects larger leaps (symmetric)", () => {
    expect(isWithinLeap(0, 4, 4)).toBe(true); // at the boundary
    expect(isWithinLeap(0, 5, 4)).toBe(false);
    expect(isWithinLeap(7, 3, 4)).toBe(true); // downward, |−4| = 4
    expect(isWithinLeap(7, 2, 4)).toBe(false);
  });

  it("defaults the cap to 4 scale degrees", () => {
    expect(DEFAULT_MAX_LEAP).toBe(4);
    expect(isWithinLeap(0, 4)).toBe(true);
    expect(isWithinLeap(0, 5)).toBe(false);
  });

  it("capLeap clamps to the cap, preserving direction, and passes through small moves", () => {
    expect(capLeap(0, 9, 4)).toBe(4); // clamp up
    expect(capLeap(10, 2, 4)).toBe(6); // clamp down
    expect(capLeap(5, 6, 4)).toBe(6); // within → unchanged
    expect(capLeap(5, 5, 4)).toBe(5);
  });

  it("capLeap equals an exact clamp to [prev-cap, prev+cap] (any prev/candidate/cap)", () => {
    // Subsumes within-cap, direction-preservation, and pass-through in one shot;
    // a wrong-direction or always-clamp regression fails this immediately.
    fc.assert(
      fc.property(
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: 0, max: 12 }),
        (prev, cand, cap) => {
          const expected = Math.max(prev - cap, Math.min(prev + cap, cand));
          expect(capLeap(prev, cand, cap)).toBe(expected);
        },
      ),
    );
  });

  it("capLeap uses the default cap of 4", () => {
    expect(capLeap(0, 10)).toBe(4);
    expect(capLeap(0, 2)).toBe(2);
  });
});

describe("phrase resolution", () => {
  const penta = SCALES.majorPentatonic; // [0,2,4,7,9] → stable degree indices 0,2,3
  const major = SCALES.major; // [0,2,4,5,7,9,11] → stable degree indices 0,2,4

  it("identifies tonic/third/fifth as stable in major pentatonic", () => {
    expect([0, 1, 2, 3, 4].map((d) => isStableDegree(penta, d))).toEqual([
      true, // tonic (0 semitones)
      false, // 2nd (2)
      true, // third (4)
      true, // fifth (7)
      false, // 6th (9)
    ]);
  });

  it("identifies tonic/third/fifth as stable in the major scale", () => {
    expect([0, 2, 4].map((d) => isStableDegree(major, d))).toEqual([true, true, true]);
    expect([1, 3, 5, 6].map((d) => isStableDegree(major, d))).toEqual([false, false, false, false]);
  });

  it("stability is octave-invariant", () => {
    for (const degree of [0, 1, 2, 3, 4]) {
      expect(isStableDegree(penta, degree + penta.length)).toBe(isStableDegree(penta, degree));
      expect(isStableDegree(penta, degree - penta.length)).toBe(isStableDegree(penta, degree));
    }
  });

  it("nearestStableDegree returns the degree itself when already stable", () => {
    expect(nearestStableDegree(penta, 0)).toBe(0);
    expect(nearestStableDegree(penta, 2)).toBe(2);
  });

  it("resolves an unstable degree to the nearest stable one, preferring downward on ties", () => {
    // penta degree 1 (the 2nd): neighbours 0 (stable) and 2 (stable) are equidistant → pick down.
    expect(nearestStableDegree(penta, 1)).toBe(0);
    // penta degree 4 (the 6th): nearest stable is 3 (down) vs 5 (=tonic up); down wins on tie.
    expect(nearestStableDegree(penta, 4)).toBe(3);
  });

  it("always returns a stable degree, for any degree and either scale", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(penta, major),
        fc.integer({ min: -40, max: 40 }),
        (scale, degree) => {
          const resolved = nearestStableDegree(scale, degree);
          expect(isStableDegree(scale, resolved)).toBe(true);
          expect(Math.abs(resolved - degree)).toBeLessThanOrEqual(scale.length);
        },
      ),
    );
  });
});

describe("contour shaping", () => {
  it("arch rises to an apex mid-phrase and returns to the baseline at the ends", () => {
    const length = 9;
    const amp = 4;
    expect(contourTarget("arch", 0, length, amp)).toBeCloseTo(0, 10);
    expect(contourTarget("arch", length - 1, length, amp)).toBeCloseTo(0, 10);
    expect(contourTarget("arch", (length - 1) / 2, length, amp)).toBeCloseTo(amp, 10); // apex
  });

  it("arch is symmetric about its midpoint", () => {
    const length = 11;
    for (let i = 0; i < length; i++) {
      expect(contourTarget("arch", i, length, 3)).toBeCloseTo(
        contourTarget("arch", length - 1 - i, length, 3),
        10,
      );
    }
  });

  it("rising ramps 0 → amplitude; falling ramps amplitude → 0", () => {
    expect(contourTarget("rising", 0, 5, 4)).toBeCloseTo(0, 10);
    expect(contourTarget("rising", 4, 5, 4)).toBeCloseTo(4, 10);
    expect(contourTarget("falling", 0, 5, 4)).toBeCloseTo(4, 10);
    expect(contourTarget("falling", 4, 5, 4)).toBeCloseTo(0, 10);
  });

  it("rising is non-decreasing and falling is non-increasing across the phrase", () => {
    // Endpoints alone don't lock the ramp; a distorted interior must fail too.
    const length = 12;
    for (let i = 1; i < length; i++) {
      expect(contourTarget("rising", i, length, 4)).toBeGreaterThanOrEqual(
        contourTarget("rising", i - 1, length, 4),
      );
      expect(contourTarget("falling", i, length, 4)).toBeLessThanOrEqual(
        contourTarget("falling", i - 1, length, 4),
      );
    }
  });

  it("amplitude 0 flattens every shape to zero", () => {
    for (const shape of ["arch", "rising", "falling", "flat"] as const) {
      for (let i = 0; i < 6; i++) {
        expect(contourTarget(shape, i, 6, 0)).toBe(0);
      }
    }
  });

  it("flat is always zero, and degenerate lengths are zero", () => {
    expect(contourTarget("flat", 2, 5, 4)).toBe(0);
    expect(contourTarget("arch", 0, 1, 4)).toBe(0);
    expect(contourTarget("rising", 0, 0, 4)).toBe(0);
  });
});

describe("anti-repeat (note level)", () => {
  it("allows repeats up to the limit, then rejects", () => {
    expect(exceedsRepeatLimit([], 5, 2)).toBe(false); // 1st
    expect(exceedsRepeatLimit([5], 5, 2)).toBe(false); // 2nd
    expect(exceedsRepeatLimit([5, 5], 5, 2)).toBe(true); // 3rd would exceed
  });

  it("only counts the trailing run; a different note resets it", () => {
    expect(exceedsRepeatLimit([5, 5, 3], 3, 2)).toBe(false);
    expect(exceedsRepeatLimit([3, 5, 5], 5, 2)).toBe(true);
    expect(exceedsRepeatLimit([5, 5], 3, 2)).toBe(false); // candidate differs
  });

  it("respects the default and a custom limit", () => {
    expect(exceedsRepeatLimit([7, 7], 7)).toBe(true); // default 2
    expect(exceedsRepeatLimit([7, 7], 7, 3)).toBe(false); // allow 3 in a row
  });

  it("supports maxRepeat=1 (never repeat a note)", () => {
    expect(exceedsRepeatLimit([], 5, 1)).toBe(false); // first occurrence is fine
    expect(exceedsRepeatLimit([5], 5, 1)).toBe(true); // a second in a row exceeds
  });
});

describe("ShuffleBag", () => {
  it("throws when constructed empty", () => {
    expect(() => new ShuffleBag([])).toThrow(RangeError);
  });

  it("returns only items it was given, and draws every item each cycle", () => {
    const items = ["a", "b", "c", "d"] as const;
    const bag = new ShuffleBag(items);
    const rng = makeRng(1);
    const cycle = Array.from({ length: items.length }, () => bag.next(rng));
    expect(new Set(cycle)).toEqual(new Set(items)); // a full cycle = one of each
  });

  it("every aligned block of n draws is a full permutation (each cycle, any seed)", () => {
    // Locks sampling-without-replacement beyond cycle 1, where the refill
    // boundary guard runs: a rewrite that avoided adjacency but dropped or
    // duplicated an item within a cycle would fail here.
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const items = [0, 1, 2, 3, 4];
        const n = items.length;
        const bag = new ShuffleBag(items);
        const rng = makeRng(seed);
        const cycles = 8;
        const draws = Array.from({ length: n * cycles }, () => bag.next(rng));
        for (let c = 0; c < cycles; c++) {
          expect(new Set(draws.slice(c * n, c * n + n))).toEqual(new Set(items));
        }
      }),
      { numRuns: 200 },
    );
  });

  it("never returns the same item twice in a row (any seed)", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const bag = new ShuffleBag([0, 1, 2, 3, 4]);
        const rng = makeRng(seed);
        let prev = bag.next(rng);
        for (let i = 0; i < 200; i++) {
          const cur = bag.next(rng);
          expect(cur).not.toBe(prev);
          prev = cur;
        }
      }),
      { numRuns: 300 },
    );
  });

  it("is deterministic for a given seed", () => {
    const draw = (seed: number) => {
      const bag = new ShuffleBag(["x", "y", "z"]);
      const rng = makeRng(seed);
      return Array.from({ length: 30 }, () => bag.next(rng));
    };
    expect(draw(42)).toEqual(draw(42));
    expect(draw(1)).not.toEqual(draw(2));
  });

  it("handles a single-item bag (returns it every time)", () => {
    const bag = new ShuffleBag(["solo"]);
    const rng = makeRng(9);
    for (let i = 0; i < 10; i++) {
      expect(bag.next(rng)).toBe("solo");
    }
  });
});
