import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generateHarmony } from "../src/compose/harmony";
import { type MelodyNote, generateMelody } from "../src/compose/melody";
import {
  type DevelopOptions,
  MOTIF_TRANSFORMS,
  type MotifTransform,
  developMotif,
} from "../src/compose/motif";
import { makeRng } from "../src/rng";
import { STRONG_THRESHOLD, metricStrength } from "../src/theory/rhythm";
import { SCALES } from "../src/theory/scales";

const BEATS_PER_BAR = 4;
const MOTIF_BARS = 2;

const opts = (over: Partial<DevelopOptions> = {}): DevelopOptions => ({
  beatsPerBar: BEATS_PER_BAR,
  motifBars: MOTIF_BARS,
  sectionBars: 8,
  range: [0, 7],
  degreesPerOctave: SCALES.major.length,
  maxLeap: 4,
  ...over,
});

/** A realistic theme: exactly how `buildForm` draws one — a melody over the opening bars. */
function makeMotif(seed: number): readonly MelodyNote[] {
  const plan = generateHarmony({
    rng: makeRng(seed),
    scale: SCALES.major,
    rootMidi: 60,
    bars: 8,
    beatsPerBar: BEATS_PER_BAR,
  });
  return generateMelody({
    rng: makeRng(seed + 1),
    plan: { ...plan, bars: plan.bars.slice(0, MOTIF_BARS), cadences: { half: -1, final: -1 } },
    scale: SCALES.major,
    density: 0.5,
  });
}

const degrees = (notes: readonly MelodyNote[]) => notes.map((n) => n.degree);
const intervals = (notes: readonly MelodyNote[]) =>
  degrees(notes)
    .slice(1)
    .map((d, i) => d - (degrees(notes)[i] as number));

describe("developMotif", () => {
  it("states the theme unchanged", () => {
    const motif = makeMotif(3);
    const out = developMotif(motif, { transform: "statement", step: 0 }, opts());
    expect(out.notes).toEqual(motif);
    expect(out.bars).toBe(MOTIF_BARS);
  });

  it("sequence moves the theme in degrees, keeping its shape and rhythm", () => {
    const motif = makeMotif(3);
    const out = developMotif(motif, { transform: "sequence", step: 1 }, opts({ range: [-7, 14] }));
    expect(intervals(out.notes)).toEqual(intervals(motif)); // the shape survives intact
    expect(out.notes.map((n) => n.startBeat)).toEqual(motif.map((n) => n.startBeat));
    expect(degrees(out.notes)).toEqual(degrees(motif).map((d) => d + 1)); // ...one degree higher
    expect(out.bars).toBe(MOTIF_BARS);
  });

  it("inversion mirrors the contour about the opening degree", () => {
    const motif = makeMotif(3);
    const out = developMotif(motif, { transform: "inversion", step: 0 }, opts({ range: [-7, 14] }));
    // Every rise becomes an equal fall — the answer to the theme, not a new tune.
    expect(intervals(out.notes)).toEqual(intervals(motif).map((i) => (i === 0 ? 0 : -i)));
    expect(out.notes[0]!.degree).toBe(motif[0]!.degree); // the pivot itself is fixed
  });

  it("augmentation broadens the theme: twice the note values, twice the span", () => {
    const motif = makeMotif(3);
    const out = developMotif(motif, { transform: "augmentation", step: 0 }, opts());
    expect(out.bars).toBe(MOTIF_BARS * 2);
    expect(degrees(out.notes)).toEqual(degrees(motif)); // same notes, said slower
    for (const [i, n] of out.notes.entries()) {
      expect(n.startBeat).toBe(motif[i]!.startBeat * 2);
      expect(n.durationBeats).toBe(motif[i]!.durationBeats * 2);
    }
    // Notes land in new metric places, so every one has its weight re-read.
    expect(out.notes.map((n) => n.strong)).toEqual(
      out.notes.map(
        (n) => metricStrength(n.startBeat % BEATS_PER_BAR, BEATS_PER_BAR) >= STRONG_THRESHOLD,
      ),
    );
  });

  it("augmentation promotes a note that broadening carries onto a stronger beat", () => {
    const motif: readonly MelodyNote[] = [
      { startBeat: 0, durationBeats: 1, degree: 0, velocity: 0.7, strong: true },
      { startBeat: 1, durationBeats: 1, degree: 1, velocity: 0.7, strong: false }, // a plain on-beat
    ];
    const out = developMotif(motif, { transform: "augmentation", step: 0 }, opts());
    expect(out.notes[1]!.startBeat).toBe(2); // doubling carries it to the 4/4 midpoint…
    expect(out.notes[1]!.strong).toBe(true); // …where it now wants a chord tone
  });

  it("augmentation yields to the statement rather than swallow the section", () => {
    const motif = makeMotif(3);
    // A doubled 2-bar theme needs more than 4 bars, or the section is nothing but theme.
    const tight = developMotif(
      motif,
      { transform: "augmentation", step: 0 },
      opts({ sectionBars: 4 }),
    );
    expect(tight.notes).toEqual(motif);
    expect(tight.bars).toBe(MOTIF_BARS);
    const roomy = developMotif(
      motif,
      { transform: "augmentation", step: 0 },
      opts({ sectionBars: 5 }),
    );
    expect(roomy.bars).toBe(MOTIF_BARS * 2);
  });

  it("fragmentation repeats the head, lifted, without the repeats overlapping", () => {
    const motif = makeMotif(3);
    const out = developMotif(
      motif,
      { transform: "fragmentation", step: 1 },
      opts({ range: [-7, 14] }),
    );
    const head = motif.filter((n) => n.startBeat < BEATS_PER_BAR);
    expect(out.notes.length).toBe(head.length * MOTIF_BARS);
    // The head returns a bar later, one degree higher — the theme insisted on.
    for (const [i, n] of head.entries()) {
      const echo = out.notes[head.length + i]!;
      expect(echo.startBeat).toBe(n.startBeat + BEATS_PER_BAR);
      expect(echo.degree).toBe(n.degree + 1);
    }
    // A sustained head note is trimmed at the bar line so the echo isn't sung over it.
    for (const n of out.notes) {
      expect(n.startBeat + n.durationBeats).toBeLessThanOrEqual(
        Math.floor(n.startBeat / BEATS_PER_BAR) * BEATS_PER_BAR + BEATS_PER_BAR + 1e-9,
      );
    }
  });

  it("yields to the statement when a transform would break the line's leap cap", () => {
    // A head that ends far from where it begins: repeating it would demand a jump
    // no singer of this line could make, so the plain theme is the honest answer.
    const wide: readonly MelodyNote[] = [
      { startBeat: 0, durationBeats: 1, degree: 0, velocity: 0.7, strong: true },
      { startBeat: 1, durationBeats: 1, degree: 6, velocity: 0.7, strong: false },
    ];
    const out = developMotif(wide, { transform: "fragmentation", step: 0 }, opts({ maxLeap: 2 }));
    expect(out.notes).toEqual(wide);
  });

  it("keeps every transform inside the range, ordered, and within the leap cap", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 400 }),
        fc.constantFrom(...MOTIF_TRANSFORMS),
        fc.integer({ min: -2, max: 2 }),
        (seed, transform: MotifTransform, step) => {
          const motif = makeMotif(seed);
          const o = opts();
          const out = developMotif(motif, { transform, step }, o);
          const [lo, hi] = o.range;
          expect(out.bars).toBeGreaterThan(0);
          for (const n of out.notes) {
            expect(n.degree).toBeGreaterThanOrEqual(lo); // a transposed theme stays singable
            expect(n.degree).toBeLessThanOrEqual(hi);
            expect(n.durationBeats).toBeGreaterThan(0);
            expect(n.startBeat).toBeGreaterThanOrEqual(0);
            expect(n.startBeat + n.durationBeats).toBeLessThanOrEqual(
              out.bars * BEATS_PER_BAR + 1e-9, // never spills past the span it claims
            );
          }
          for (let i = 1; i < out.notes.length; i++) {
            const prev = out.notes[i - 1]!;
            const cur = out.notes[i]!;
            expect(cur.startBeat).toBeGreaterThanOrEqual(prev.startBeat); // ordered
            expect(Math.abs(cur.degree - prev.degree)).toBeLessThanOrEqual(o.maxLeap);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("is pure: same input, same output, and the source theme is untouched", () => {
    const motif = makeMotif(9);
    const before = structuredClone(motif) as MelodyNote[];
    const dev = { transform: "inversion", step: 0 } as const;
    expect(developMotif(motif, dev, opts())).toEqual(developMotif(motif, dev, opts()));
    expect(motif).toEqual(before);
  });

  it("handles an empty theme", () => {
    expect(developMotif([], { transform: "augmentation", step: 0 }, opts())).toEqual({
      notes: [],
      bars: MOTIF_BARS,
    });
  });
});
