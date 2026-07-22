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

  it("anchors the cadence: tonic at the loop, open V at the midpoint, a V-or-IV approach", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 4, max: 24 }), (seed, bars) => {
        const p = plan(seed, { bars, generate: true });
        expect(p.cadences.final).toBe(bars - 1);
        expect(p.cadences.half).toBe(Math.floor(bars / 2) - 1);
        expect(p.bars[p.cadences.final]!.degree).toBe(0); // I — always resolves at the loop point
        expect(p.bars[p.cadences.half]!.degree).toBe(4); // V — the open half-cadence
        // Approach: IV (plagal) or V (authentic / ii–V) — or ii when the bar divides,
        // in which case the V it moves to is what leads into the resolution.
        const approach = p.bars[bars - 2]!;
        const leadsIn = approach.second ? approach.second.degree : approach.degree;
        expect([3, 4]).toContain(leadsIn);
      }),
      { numRuns: 200 },
    );
  });

  it("varies the cadence approach across the corpus — both plagal (IV) and authentic (V) appear", () => {
    const approaches = new Set<number>();
    for (let s = 1; s < 60; s++) {
      approaches.add(
        generateHarmony({ rng: makeRng(s), scale: SCALES.major, bars: 8 }).bars[6]!.degree,
      );
    }
    expect(approaches.has(3)).toBe(true); // plagal IV→I
    expect(approaches.has(4)).toBe(true); // authentic V→I
  });
});

describe("generateHarmony — progression sources", () => {
  it("tiles an explicit progression, then overwrites the cadence bars", () => {
    // Base [0,3,5,2] tiles to [0,3,5,2,0,3,5,2]; the cadence then overwrites the tail.
    const degs = generateHarmony({ rng: makeRng(1), progression: [0, 3, 5, 2], bars: 8 }).bars.map(
      (b) => b.degree,
    );
    expect(degs.slice(0, 3)).toEqual([0, 3, 5]); // body shows the tiled progression, untouched
    expect([degs[4], degs[5]]).toEqual([0, 3]); // …and again before the cadence
    expect(degs[3]).toBe(4); // half → V
    expect(degs[7]).toBe(0); // final → I
    // Approach → IV or V, or a divided bar whose SECOND chord leads into the resolution.
    const approach = generateHarmony({ rng: makeRng(1), progression: [0, 3, 5, 2], bars: 8 })
      .bars[6]!;
    expect([3, 4]).toContain(approach.second ? approach.second.degree : approach.degree);
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

describe("generateHarmony — borrowed chords (modal interchange)", () => {
  const pcsOf = (s: readonly number[]) => new Set(s);
  const nonDiatonic = (p: ReturnType<typeof plan>, scale: readonly number[]) =>
    p.bars.some((b) => b.chord.pcs.some((pc) => !pcsOf(scale).has(pc)));

  it("introduces an occasional non-diatonic chord over a bright-major parent", () => {
    let found = false;
    for (let s = 1; s < 60 && !found; s++) {
      found = nonDiatonic(plan(s, { scale: SCALES.major, bars: 8, borrow: true }), SCALES.major);
    }
    expect(found).toBe(true);
  });

  it("stays diatonic over a non-bright parent even with borrow on", () => {
    for (let s = 1; s < 40; s++) {
      const p = plan(s, { scale: SCALES.naturalMinor, bars: 8, borrow: true });
      expect(nonDiatonic(p, SCALES.naturalMinor)).toBe(false);
    }
  });

  it("stays fully diatonic when borrow is off (the default)", () => {
    for (let s = 1; s < 40; s++) {
      expect(nonDiatonic(plan(s, { scale: SCALES.major, bars: 8 }), SCALES.major)).toBe(false);
    }
  });

  it("never borrows on the tonic anchor or the cadence bars", () => {
    for (let s = 1; s < 60; s++) {
      const p = plan(s, { scale: SCALES.major, bars: 8, borrow: true });
      const protectedBars = new Set([0, p.cadences.half, p.cadences.final, p.cadences.final - 1]);
      const borrowedIdx = p.bars
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => b.chord.pcs.some((pc) => !pcsOf(SCALES.major).has(pc)))
        .map(({ i }) => i);
      for (const i of borrowedIdx) expect(protectedBars.has(i)).toBe(false);
    }
  });
});

describe("generateHarmony — borrowed chords are tonic-relative (any key)", () => {
  it("places ♭VII/♭VI/iv at the same tonic-relative pcs regardless of rootMidi", () => {
    const SHAPES = [
      [10, 2, 5], // ♭VII major
      [8, 0, 3], // ♭VI major
      [5, 8, 0], // iv minor
    ].map((a) => [...a].sort((x, y) => x - y).join(","));
    const majorPcs = new Set<number>(SCALES.major);
    for (const rootMidi of [60, 62, 57, 65]) {
      // C, D, A, F tonics
      for (let s = 1; s < 80; s++) {
        const p = plan(s, { scale: SCALES.major, rootMidi, bars: 8, borrow: true });
        const borrowed = p.bars
          .map((b) => b.chord)
          .filter((c) => c.pcs.some((pc) => !majorPcs.has(pc)));
        for (const c of borrowed) {
          expect(SHAPES).toContain([...c.pcs].sort((x, y) => x - y).join(","));
        }
      }
    }
  });
});

describe("generateHarmony — seventh-chord colour", () => {
  it("voices the named degrees with their diatonic seventh, in key", () => {
    const plan = generateHarmony({
      rng: makeRng(3),
      scale: SCALES.major,
      bars: 8,
      beatsPerBar: 4,
      progression: [1, 3, 4, 5], // ii IV V vi
      sevenths: [1, 3, 4, 5],
    });
    const majorPcs = new Set<number>(SCALES.major);
    // Body chords on the named degrees carry a seventh (four tones); the final tonic
    // stays a triad and is excluded.
    const bodySevenths = plan.bars.filter(
      (bar, i) => bar.degree !== 0 && i !== plan.cadences.final,
    );
    expect(bodySevenths.length).toBeGreaterThan(0);
    expect(bodySevenths.every((bar) => bar.chord.pcs.length === 4)).toBe(true);
    // …and every tone is diatonic — a seventh is never out of key.
    const outOfKey = plan.bars.flatMap((bar) =>
      bar.chord.pcs.filter((pc) => !majorPcs.has(((pc % 12) + 12) % 12)),
    );
    expect(outOfKey).toEqual([]);
  });

  it("keeps the final resolution a plain triad, so the loop still lands", () => {
    const plan = generateHarmony({
      rng: makeRng(5),
      scale: SCALES.major,
      bars: 8,
      sevenths: [0, 1, 2, 3, 4, 5, 6], // seventh on everything
    });
    expect(plan.bars[plan.cadences.final]!.chord.pcs.length).toBe(3); // the tonic lands clean
  });

  it("is all triads when no degrees are named (the default)", () => {
    const plan = generateHarmony({ rng: makeRng(7), scale: SCALES.major, bars: 8 });
    for (const bar of plan.bars) expect(bar.chord.pcs.length).toBeLessThanOrEqual(3);
  });
});
