import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { chordTonesInScale, generateHarmony } from "../src/compose/harmony";
import { type MelodyNote, type MelodyOptions, generateMelody } from "../src/compose/melody";
import { makeRng } from "../src/rng";
import { SCALES, type Scale, degreePitchClass } from "../src/theory/scales";

interface SetupOpts {
  seed?: number;
  parent?: Scale;
  raga?: Scale;
  bars?: number;
  maxLeap?: number;
  maxNoteRepeat?: number;
  range?: readonly [number, number];
  density?: number;
}

function setup(o: SetupOpts = {}) {
  const seed = o.seed ?? 1;
  const parent = o.parent ?? SCALES.major;
  const raga = o.raga ?? SCALES.mohanam;
  const plan = generateHarmony({ rng: makeRng(seed), scale: parent, bars: o.bars ?? 8 });
  const opts: MelodyOptions = {
    rng: makeRng(seed + 1000),
    plan,
    scale: raga,
    ...(o.maxLeap !== undefined ? { maxLeap: o.maxLeap } : {}),
    ...(o.maxNoteRepeat !== undefined ? { maxNoteRepeat: o.maxNoteRepeat } : {}),
    ...(o.range !== undefined ? { range: o.range } : {}),
    ...(o.density !== undefined ? { density: o.density } : {}),
  };
  return { plan, raga, notes: generateMelody(opts) };
}

const barOf = (startBeat: number, beatsPerBar: number) => Math.floor(startBeat / beatsPerBar);

describe("generateMelody — invariants", () => {
  it("never leaps more than maxLeap, for any seed / parent / raga / leap", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.constantFrom(SCALES.major, SCALES.dorian, SCALES.harmonicMinor),
        fc.integer({ min: 2, max: 5 }),
        (seed, parent, maxLeap) => {
          const { notes } = setup({ seed, parent, maxLeap });
          for (let i = 1; i < notes.length; i++) {
            expect(Math.abs(notes[i]!.degree - notes[i - 1]!.degree)).toBeLessThanOrEqual(maxLeap);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("states a motif verbatim at the head, then generates the continuation", () => {
    const plan = generateHarmony({ rng: makeRng(1), scale: SCALES.major, bars: 8 });
    const motif: MelodyNote[] = [
      { startBeat: 0, durationBeats: 1, degree: 0, velocity: 0.7, strong: true },
      { startBeat: 1, durationBeats: 1, degree: 2, velocity: 0.6, strong: false },
    ];
    const withMotif = generateMelody({
      rng: makeRng(9),
      plan,
      scale: SCALES.mohanam,
      motif,
      motifBars: 1,
    });
    expect(withMotif.slice(0, 2)).toEqual(motif); // head is the theme, verbatim
    expect(withMotif[2]!.startBeat).toBeGreaterThanOrEqual(4); // continuation starts after bar 0
    const withoutMotif = generateMelody({ rng: makeRng(9), plan, scale: SCALES.mohanam });
    expect(withMotif).not.toEqual(withoutMotif); // the motif actually shaped the line
  });

  it("lands a chord tone on every strong beat (mohanam over major, default leap)", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const { plan, raga, notes } = setup({ seed });
        for (const note of notes) {
          if (!note.strong) continue;
          const chord = plan.bars[barOf(note.startBeat, plan.beatsPerBar)]!.chord;
          expect(chord.pcs).toContain(degreePitchClass(raga, note.degree));
        }
      }),
      { numRuns: 200 },
    );
  });

  it("resolves the cadences: final → tonic, half-cadence bar → a V-chord tone", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const { plan, raga, notes } = setup({ seed });
        const bpb = plan.beatsPerBar;
        const lastInBar = (bar: number) =>
          notes.filter((n) => barOf(n.startBeat, bpb) === bar).at(-1)!;

        const final = lastInBar(plan.cadences.final);
        expect(degreePitchClass(raga, final.degree)).toBe(0); // tonic

        const half = lastInBar(plan.cadences.half);
        const halfChord = plan.bars[plan.cadences.half]!.chord;
        expect(halfChord.pcs).toContain(degreePitchClass(raga, half.degree));
      }),
      { numRuns: 200 },
    );
  });

  it("keeps repeats at maxNoteRepeat, exceeding only at a forced strong/cadence note", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const { plan, notes } = setup({ seed, maxNoteRepeat: 2 });
        const bpb = plan.beatsPerBar;
        let run = 0;
        let prev: number | null = null;
        for (let i = 0; i < notes.length; i++) {
          const n = notes[i]!;
          run = n.degree === prev ? run + 1 : 1;
          const bar = barOf(n.startBeat, bpb);
          const lastInBar = i === notes.length - 1 || barOf(notes[i + 1]!.startBeat, bpb) !== bar;
          const cadenceLast =
            lastInBar && (bar === plan.cadences.half || bar === plan.cadences.final);
          // run may reach maxNoteRepeat+1 ONLY when forced (a strong chord tone or a cadence resolution)
          expect(run <= 2 || (run === 3 && (n.strong || cadenceLast))).toBe(true);
          prev = n.degree;
        }
      }),
      { numRuns: 200 },
    );
  });

  it("keeps every degree within range (default and custom)", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.constantFrom<readonly [number, number]>([0, 7], [0, 14], [-3, 9]),
        (seed, range) => {
          const { notes } = setup({ seed, range });
          for (const n of notes) {
            expect(n.degree).toBeGreaterThanOrEqual(range[0]);
            expect(n.degree).toBeLessThanOrEqual(range[1]);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it("opens on a tonic-chord tone (bar 0 is I)", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.constantFrom(SCALES.mohanam, SCALES.hamsadhwani, SCALES.major),
        (seed, raga) => {
          const { plan, notes } = setup({ seed, raga });
          expect(plan.bars[0]!.chord.pcs).toContain(degreePitchClass(raga, notes[0]!.degree));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("lands a chord tone on strong beats wherever the chord shares a raga tone (any pair)", () => {
    const pairs: ReadonlyArray<readonly [Scale, Scale]> = [
      [SCALES.major, SCALES.mohanam],
      [SCALES.major, SCALES.hamsadhwani],
      [SCALES.major, SCALES.hindolam], // sparse overlap → exercises the empty-intersection fallback
      [SCALES.dorian, SCALES.minorPentatonic],
    ];
    fc.assert(
      fc.property(fc.integer(), fc.constantFrom(...pairs), (seed, [parent, raga]) => {
        const { plan, notes } = setup({ seed, parent, raga });
        for (const n of notes) {
          if (!n.strong) continue;
          const chord = plan.bars[barOf(n.startBeat, plan.beatsPerBar)]!.chord;
          const shared = chordTonesInScale(chord, raga);
          if (shared.length === 0) continue; // no chord tone in the raga → fallback is exempt
          expect(shared).toContain(degreePitchClass(raga, n.degree));
        }
      }),
      { numRuns: 150 },
    );
  });

  it("is time-ordered with strong beats accented and velocities in 0..1", () => {
    const { notes } = setup({ seed: 5 });
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i]!.startBeat).toBeGreaterThanOrEqual(notes[i - 1]!.startBeat);
    }
    for (const n of notes) {
      expect(n.velocity).toBeGreaterThan(0);
      expect(n.velocity).toBeLessThanOrEqual(1);
    }
    const weakMax = Math.max(...notes.filter((n) => !n.strong).map((n) => n.velocity));
    const strongMin = Math.min(...notes.filter((n) => n.strong).map((n) => n.velocity));
    expect(strongMin).toBeGreaterThan(weakMax); // strong beats louder
  });

  it("works with a pentatonic raga (no heptatonic requirement)", () => {
    const { raga, notes } = setup({ seed: 9, raga: SCALES.hamsadhwani });
    const allowed = new Set(raga.map((s) => ((s % 12) + 12) % 12));
    for (const n of notes) expect(allowed.has(degreePitchClass(raga, n.degree))).toBe(true);
  });
});

describe("generateMelody — shaping", () => {
  it("shapes an arch: weak beats ride higher mid-phrase than at phrase edges", () => {
    let midSum = 0;
    let midN = 0;
    let edgeSum = 0;
    let edgeN = 0;
    for (let seed = 0; seed < 200; seed++) {
      const { plan, notes } = setup({ seed, bars: 16 });
      for (const n of notes) {
        if (n.strong) continue; // strong beats are forced to chord tones; measure the weak shaping
        const phraseBar = barOf(n.startBeat, plan.beatsPerBar) % 4;
        if (phraseBar === 1 || phraseBar === 2) {
          midSum += n.degree;
          midN++;
        } else {
          edgeSum += n.degree;
          edgeN++;
        }
      }
    }
    expect(midSum / midN).toBeGreaterThan(edgeSum / edgeN);
  });

  it("forwards density to the rhythm (denser → more notes)", () => {
    expect(setup({ seed: 3, density: 1 }).notes.length).toBeGreaterThan(
      setup({ seed: 3, density: 0 }).notes.length,
    );
  });
});

describe("generateMelody — determinism", () => {
  it("same seeds → identical line; different seed → different", () => {
    expect(setup({ seed: 7 }).notes).toEqual(setup({ seed: 7 }).notes);
    expect(setup({ seed: 1 }).notes).not.toEqual(setup({ seed: 2 }).notes);
  });

  it("matches a committed golden snapshot", () => {
    expect(setup({ seed: 42, bars: 16 }).notes).toMatchSnapshot();
  });
});

describe("generateMelody — validation", () => {
  const plan = generateHarmony({ rng: makeRng(1), bars: 8 });
  const base = { rng: makeRng(2), plan };

  it("rejects bad options", () => {
    expect(() => generateMelody({ ...base, range: [4, 4] })).toThrow(RangeError);
    expect(() => generateMelody({ ...base, range: [0, 1.5] })).toThrow(RangeError);
    expect(() => generateMelody({ ...base, maxLeap: 0 })).toThrow(RangeError);
    expect(() => generateMelody({ ...base, maxNoteRepeat: 0 })).toThrow(RangeError);
    expect(() => generateMelody({ ...base, contourAmplitude: -1 })).toThrow(RangeError);
  });
});
