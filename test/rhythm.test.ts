import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { makeRng } from "../src/rng";
import {
  DEFAULT_RHYTHM,
  type RhythmConfig,
  barLengthSteps,
  generateBar,
  stepsToBeats,
  weightedDuration,
} from "../src/rhythm";

const allowedSteps = new Set(DEFAULT_RHYTHM.durations.map((d) => d.steps));
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe("grid helpers", () => {
  it("barLengthSteps multiplies steps/beat by beats/bar", () => {
    expect(barLengthSteps(DEFAULT_RHYTHM)).toBe(16);
    expect(barLengthSteps({ ...DEFAULT_RHYTHM, beatsPerBar: 3 })).toBe(12);
  });

  it("stepsToBeats divides by the grid resolution", () => {
    expect(stepsToBeats(4)).toBe(1); // a quarter = 1 beat
    expect(stepsToBeats(2)).toBe(0.5); // an eighth = half a beat
    expect(stepsToBeats(16)).toBe(4); // a full common-time bar
  });

  it("stepsToBeats divides by stepsPerBeat, not beatsPerBar", () => {
    // The two fields are equal (4) in the default; distinguish them explicitly.
    expect(stepsToBeats(6, { ...DEFAULT_RHYTHM, stepsPerBeat: 3, beatsPerBar: 7 })).toBe(2);
  });
});

describe("weightedDuration", () => {
  it("only returns durations from the configured set", () => {
    const rng = makeRng(1);
    for (let i = 0; i < 500; i++) {
      expect(allowedSteps.has(weightedDuration(rng))).toBe(true);
    }
  });

  it("is deterministic for a given seed", () => {
    const a = makeRng(7);
    const b = makeRng(7);
    for (let i = 0; i < 50; i++) {
      expect(weightedDuration(a)).toBe(weightedDuration(b));
    }
  });

  it("favours eighths and quarters (the dominant peppy durations)", () => {
    const rng = makeRng(2024);
    const counts = new Map<number, number>();
    const draws = 20_000;
    for (let i = 0; i < draws; i++) {
      const steps = weightedDuration(rng);
      counts.set(steps, (counts.get(steps) ?? 0) + 1);
    }
    // Eighth (2) is the single most common; quarter (4) outweighs the rare half (8).
    expect(counts.get(2)!).toBeGreaterThan(counts.get(4)!);
    expect(counts.get(4)!).toBeGreaterThan(counts.get(8)!);
  });
});

describe("generateBar", () => {
  it("fills a bar exactly, with only configured durations (any seed)", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const bar = generateBar(makeRng(seed));
        expect(sum(bar)).toBe(barLengthSteps(DEFAULT_RHYTHM));
        for (const steps of bar) {
          expect(allowedSteps.has(steps)).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("fills ANY valid config exactly, using only its durations (any seed)", () => {
    // The contract is "exact for any seed and any valid config" — so vary the
    // whole config, not just the bar length: random grid, random duration set
    // that always carries the required 1-step unit. This also makes an
    // off-by-one filter regression (`d.steps < remaining`) deterministic to
    // catch — a set like [1, 16] would then hit rng.weighted([], []).
    const validConfig = fc
      .record({
        stepsPerBeat: fc.integer({ min: 1, max: 6 }),
        beatsPerBar: fc.integer({ min: 1, max: 8 }),
        extra: fc.array(
          fc.record({
            steps: fc.integer({ min: 1, max: 12 }),
            weight: fc.integer({ min: 1, max: 10 }),
          }),
          { maxLength: 6 },
        ),
      })
      .map(
        ({ stepsPerBeat, beatsPerBar, extra }): RhythmConfig => ({
          stepsPerBeat,
          beatsPerBar,
          durations: [{ steps: 1, weight: 1 }, ...extra],
        }),
      );

    fc.assert(
      fc.property(fc.integer(), validConfig, (seed, config) => {
        const allowed = new Set(config.durations.map((d) => d.steps));
        const bar = generateBar(makeRng(seed), config);
        let remaining = barLengthSteps(config);
        for (const steps of bar) {
          expect(allowed.has(steps)).toBe(true);
          expect(steps).toBeLessThanOrEqual(remaining);
          remaining -= steps;
        }
        expect(remaining).toBe(0); // exact fill + termination
      }),
      { numRuns: 1000 },
    );
  });

  it("weights its own picks (a skewed set makes eighths dominate bar openings)", () => {
    // generateBar issues its own inline rng.weighted over the fitting subset; a
    // regression that picked uniformly or misaligned steps/weights would still
    // sum exactly. This locks that the weighting is actually applied.
    const config: RhythmConfig = {
      stepsPerBeat: 4,
      beatsPerBar: 4,
      durations: [
        { steps: 1, weight: 1 },
        { steps: 2, weight: 9 },
      ],
    };
    let eighthOpenings = 0;
    const bars = 4000;
    for (let seed = 0; seed < bars; seed++) {
      if (generateBar(makeRng(seed), config)[0] === 2) eighthOpenings++;
    }
    expect(eighthOpenings / bars).toBeGreaterThan(0.8); // ~0.9 expected
  });

  it("is deterministic for a given seed", () => {
    expect(generateBar(makeRng(123))).toEqual(generateBar(makeRng(123)));
  });

  it("matches a known-answer snapshot (guards the algorithm byte-for-byte)", () => {
    expect(generateBar(makeRng(42))).toEqual([3, 2, 4, 4, 1, 2]);
  });

  it("never overshoots the bar (every duration fits the remaining space)", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const bar = generateBar(makeRng(seed));
        let remaining = barLengthSteps(DEFAULT_RHYTHM);
        for (const steps of bar) {
          expect(steps).toBeLessThanOrEqual(remaining);
          remaining -= steps;
        }
        expect(remaining).toBe(0);
      }),
      { numRuns: 500 },
    );
  });
});

describe("config validation", () => {
  const bad: Array<[string, Partial<RhythmConfig>]> = [
    ["fractional stepsPerBeat", { stepsPerBeat: 2.5 }],
    ["zero stepsPerBeat", { stepsPerBeat: 0 }],
    ["zero beatsPerBar", { beatsPerBar: 0 }],
    ["empty durations", { durations: [] }],
    ["no 1-step unit", { durations: [{ steps: 2, weight: 1 }] }],
    ["fractional steps", { durations: [{ steps: 1.5, weight: 1 }] }],
    ["non-positive weight", { durations: [{ steps: 1, weight: 0 }] }],
  ];

  it.each(bad)("rejects %s", (_, patch) => {
    const config = { ...DEFAULT_RHYTHM, ...patch };
    expect(() => generateBar(makeRng(1), config)).toThrow(RangeError);
    expect(() => weightedDuration(makeRng(1), config)).toThrow(RangeError);
  });

  it("accepts the default config", () => {
    expect(() => generateBar(makeRng(1))).not.toThrow();
  });
});
