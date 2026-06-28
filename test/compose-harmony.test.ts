import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type HarmonyOptions, chordTonesInScale, generateHarmony } from "../src/compose/harmony";
import { makeRng } from "../src/rng";
import { diatonicChord } from "../src/theory/chords";
import { PROGRESSIONS } from "../src/theory/progressions";
import { SCALES, degreePitchClass } from "../src/theory/scales";

const HEPTATONIC = [SCALES.major, SCALES.dorian, SCALES.harmonicMinor, SCALES.lydian] as const;

function plan(seed: number, opts: Partial<HarmonyOptions> = {}) {
  return generateHarmony({ rng: makeRng(seed), ...opts });
}

describe("generateHarmony — shape & determinism", () => {
  it("produces the requested number of bars and defaults", () => {
    const p = plan(1);
    expect(p.bars).toHaveLength(8);
    expect(p.beatsPerBar).toBe(4);
    expect(p.scale).toBe(SCALES.major);
  });

  it("is deterministic for a seed and differs across seeds", () => {
    expect(plan(7)).toEqual(plan(7));
    expect(plan(1).bars.map((b) => b.degree)).not.toEqual(plan(2).bars.map((b) => b.degree));
  });

  it("plumbs rootMidi through and defaults to 60", () => {
    expect(plan(1).rootMidi).toBe(60);
    expect(plan(1, { rootMidi: 48 }).rootMidi).toBe(48);
  });

  it("the default source tiles a library progression (cadence bars aside)", () => {
    const p = plan(1); // default → library pick
    const degrees = p.bars.map((b) => b.degree);
    const cadence = new Set([p.cadences.half, p.cadences.final, p.cadences.final - 1]);
    const matches = Object.values(PROGRESSIONS).some((prog) =>
      degrees.every((d, i) => cadence.has(i) || d === prog[i % prog.length]),
    );
    expect(matches).toBe(true);
  });

  it("matches a committed golden snapshot (degrees + cadences only)", () => {
    const p = plan(42, { generate: true, bars: 16 });
    expect({ degrees: p.bars.map((b) => b.degree), cadences: p.cadences }).toMatchSnapshot();
  });
});

describe("generateHarmony — invariants (any seed, any heptatonic parent)", () => {
  it("each bar's chord is exactly the diatonic triad of its degree", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.constantFrom(...HEPTATONIC),
        fc.integer({ min: 4, max: 24 }),
        (seed, scale, bars) => {
          for (const bar of plan(seed, { scale, bars, generate: true }).bars) {
            expect(bar.degree).toBeGreaterThanOrEqual(0);
            expect(bar.degree).toBeLessThanOrEqual(6);
            expect(bar.chord).toEqual(diatonicChord(scale, bar.degree));
            expect(bar.chord.root).toBe(degreePitchClass(scale, bar.degree));
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("places the cadences: V at the midpoint, V→I into the loop", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 4, max: 24 }), (seed, bars) => {
        const p = plan(seed, { bars, generate: true });
        expect(p.cadences.final).toBe(bars - 1);
        expect(p.cadences.half).toBe(Math.floor(bars / 2) - 1);
        expect(p.bars[p.cadences.final]!.degree).toBe(0); // I
        expect(p.bars[bars - 2]!.degree).toBe(4); // V
        expect(p.bars[p.cadences.half]!.degree).toBe(4); // V (open)
      }),
      { numRuns: 200 },
    );
  });
});

describe("generateHarmony — progression sources", () => {
  it("tiles an explicit progression, overwriting exactly the three cadence bars", () => {
    // Base [0,3,5,2,0,3,5,2]; cadences overwrite half(3): 2→V, final-1(6): 5→V, final(7): 2→I.
    // Chosen so all three overwrites differ from the tiled body (proves each happened).
    const p = generateHarmony({ rng: makeRng(1), progression: [0, 3, 5, 2], bars: 8 });
    expect(p.bars.map((b) => b.degree)).toEqual([0, 3, 5, 4, 0, 3, 4, 0]);
  });

  it("supports odd bar counts (no even requirement)", () => {
    const p = plan(3, { bars: 5, generate: true });
    expect(p.bars).toHaveLength(5);
    expect(p.cadences).toEqual({ half: 1, final: 4 });
  });
});

describe("generateHarmony — validation", () => {
  it("rejects a non-heptatonic parent scale", () => {
    expect(() => plan(1, { scale: SCALES.majorPentatonic })).toThrow(RangeError);
    expect(() => plan(1, { scale: SCALES.blues })).toThrow(RangeError);
  });

  it("rejects bad bar/beat/root and malformed explicit progressions", () => {
    expect(() => plan(1, { bars: 3 })).toThrow(RangeError);
    expect(() => plan(1, { bars: 4.5 })).toThrow(RangeError);
    expect(() => plan(1, { beatsPerBar: 0 })).toThrow(RangeError);
    expect(() => plan(1, { beatsPerBar: 2.5 })).toThrow(RangeError); // non-integer
    expect(() => plan(1, { rootMidi: 60.5 })).toThrow(RangeError); // non-integer
    expect(() => plan(1, { progression: [] })).toThrow(RangeError);
    expect(() => plan(1, { progression: [0, 7] })).toThrow(RangeError); // > 6
    expect(() => plan(1, { progression: [0, -1] })).toThrow(RangeError); // < 0
    expect(() => plan(1, { progression: [0, 2.5] })).toThrow(RangeError); // non-integer
  });
});

describe("chordTonesInScale", () => {
  it("keeps only the chord pcs that also belong to the melody scale", () => {
    const iv = diatonicChord(SCALES.major, 3); // F A C → pcs [5,9,0]
    const tones = chordTonesInScale(iv, SCALES.mohanam); // mohanam (penta) lacks F (pc 5)
    expect(tones).not.toContain(5);
    expect(tones.every((pc) => iv.pcs.includes(pc))).toBe(true);
  });

  it("returns all chord tones when the melody scale is the parent", () => {
    const tonic = diatonicChord(SCALES.major, 0);
    expect(new Set(chordTonesInScale(tonic, SCALES.major))).toEqual(new Set(tonic.pcs));
  });
});
