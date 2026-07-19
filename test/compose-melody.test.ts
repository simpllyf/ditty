import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { chordAt, chordTonesInScale, generateHarmony } from "../src/compose/harmony";
import { type MelodyNote, type MelodyOptions, generateMelody } from "../src/compose/melody";
import { makeRng } from "../src/rng";
import { makeChord } from "../src/theory/chords";
import {
  RAGA_PATHS,
  SCALES,
  type Scale,
  degreePitchClass,
  degreeToSemitone,
} from "../src/theory/scales";

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
    // Head is the theme; its strong beat (tonic) is already a chord tone of bar 0 (I),
    // so the chord re-fit is a no-op here and the motif states unchanged.
    expect(withMotif.slice(0, 2)).toEqual(motif);
    expect(withMotif[2]!.startBeat).toBeGreaterThanOrEqual(4); // continuation starts after bar 0
    const withoutMotif = generateMelody({ rng: makeRng(9), plan, scale: SCALES.mohanam });
    expect(withMotif).not.toEqual(withoutMotif); // the motif actually shaped the line
  });

  it("re-fits the motif's strong-beat notes onto the section's own chords", () => {
    const motif: MelodyNote[] = [
      { startBeat: 0, durationBeats: 1, degree: 0, velocity: 0.7, strong: true }, // tonic — off a V chord
      { startBeat: 1, durationBeats: 1, degree: 3, velocity: 0.6, strong: false }, // weak passing tone
    ];
    // a section whose first bar is a V chord (pcs 7,11,2); the tonic (pc 0) is not in it
    const plan = {
      scale: SCALES.major,
      rootMidi: 60,
      beatsPerBar: 4,
      bars: [{ degree: 4, chord: makeChord(7, "major") }],
      cadences: { half: -1, final: -1 },
    } as const;
    const line = generateMelody({
      rng: makeRng(3),
      plan,
      scale: SCALES.major,
      motif,
      motifBars: 1,
    });
    const vTones = new Set([7, 11, 2]);
    expect(vTones.has(degreePitchClass(SCALES.major, line[0]!.degree))).toBe(true); // strong note snaps onto V
    expect(line[0]!.degree).not.toBe(0); // it actually moved off the off-chord tonic
    expect(line[1]).toEqual(motif[1]); // the weak/passing tone is left exactly as drawn
  });

  it("the contour biases the line's arc — rising trends up where falling trends down", () => {
    const plan = generateHarmony({ rng: makeRng(1), scale: SCALES.major, bars: 8 });
    const degrees = (contour: "rising" | "falling" | "arch", seed: number) =>
      generateMelody({ rng: makeRng(seed), plan, scale: SCALES.major, contour }).map(
        (n) => n.degree,
      );
    expect(degrees("rising", 2)).not.toEqual(degrees("falling", 2)); // the option is actually wired
    // averaged over seeds, a rising contour ends higher than it starts; a falling one, lower
    const trend = (contour: "rising" | "falling") => {
      let sum = 0;
      for (let s = 0; s < 30; s++) {
        const d = degrees(contour, s);
        const h = Math.floor(d.length / 2);
        const mean = (a: number[]) => a.reduce((x, n) => x + n, 0) / a.length;
        sum += mean(d.slice(h)) - mean(d.slice(0, h));
      }
      return sum / 30;
    };
    expect(trend("rising")).toBeGreaterThan(trend("falling"));
  });

  it("lands a chord tone on every strong beat (mohanam over major, default leap)", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const { plan, raga, notes } = setup({ seed });
        for (const note of notes) {
          if (!note.strong) continue;
          // The harmony can change inside a bar, so read the chord under THIS note.
          const bar = plan.bars[barOf(note.startBeat, plan.beatsPerBar)]!;
          const inBar = note.startBeat % plan.beatsPerBar;
          expect(chordAt(bar, inBar, plan.beatsPerBar).pcs).toContain(
            degreePitchClass(raga, note.degree),
          );
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
          const bar = plan.bars[barOf(n.startBeat, plan.beatsPerBar)]!;
          const chord = chordAt(bar, n.startBeat % plan.beatsPerBar, plan.beatsPerBar);
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

describe("generateMelody — how far it steps", () => {
  const semitonesOf = (notes: readonly MelodyNote[], scale: Scale) => {
    const out: number[] = [];
    for (let i = 1; i < notes.length; i++) {
      const d = Math.abs(
        degreeToSemitone(scale, notes[i]!.degree) - degreeToSemitone(scale, notes[i - 1]!.degree),
      );
      if (d > 0) out.push(d);
    }
    return out;
  };
  const meanLeap = (raga: Scale) => {
    const all: number[] = [];
    for (let seed = 0; seed < 40; seed++) {
      const { notes } = setup({ seed, raga });
      all.push(...semitonesOf(notes, raga));
    }
    return all.reduce((a, b) => a + b, 0) / all.length;
  };

  it("keeps its steps small, judging closeness in semitones rather than degrees", () => {
    // A degree is a different distance in every raga, so weighting by degree lets the
    // line travel further than it "thinks" it is. Weighting by semitones pulls both of
    // these down: degree-weighting yields 4.08 and 3.06, so these bounds fail if the
    // unit ever goes back.
    expect(meanLeap(SCALES.mohanam)).toBeLessThan(3.95);
    expect(meanLeap(SCALES.shankarabharanam)).toBeLessThan(2.95);
    // A pentatonic still steps further, and always will — its smallest interval is a
    // whole tone where a heptatonic has semitones. That gap is the raga, not a defect.
    expect(meanLeap(SCALES.mohanam)).toBeGreaterThan(meanLeap(SCALES.shankarabharanam));
  });

  it("still covers ground — smaller steps must not flatten the line", () => {
    // A melody that only ever crept would be smooth and shapeless; the contour has to
    // survive the smoothing.
    let range = 0;
    let phrases = 0;
    for (let seed = 0; seed < 25; seed++) {
      const { notes, plan } = setup({ seed });
      const phrase = 4 * plan.beatsPerBar;
      for (let start = 0; start < plan.bars.length * plan.beatsPerBar; start += phrase) {
        const inPhrase = notes.filter((n) => n.startBeat >= start && n.startBeat < start + phrase);
        if (inPhrase.length < 4) continue;
        const degrees = inPhrase.map((n) => n.degree);
        range += Math.max(...degrees) - Math.min(...degrees);
        phrases++;
      }
    }
    expect(range / phrases).toBeGreaterThan(3); // a real arc, not a crawl
  });
});

describe("generateMelody — arohana / avarohana", () => {
  const paths = RAGA_PATHS.bilahari;
  const up = new Set<number>(paths.up);
  const down = new Set<number>(paths.down);

  /** Where the line moves against the raga's grammar, and whether harmony forced it. */
  function offPath(notes: readonly MelodyNote[], scale: Scale) {
    const strays: MelodyNote[] = [];
    for (let i = 1; i < notes.length; i++) {
      const prev = notes[i - 1]!.degree;
      const cur = notes[i]!;
      if (cur.degree === prev) continue; // holding a note is free in either direction
      const pc = degreePitchClass(scale, cur.degree);
      if (!(cur.degree > prev ? up.has(pc) : down.has(pc))) strays.push(cur);
    }
    return strays;
  }

  function melody(seed: number, withPaths: boolean) {
    const plan = generateHarmony({ rng: makeRng(seed), scale: SCALES.major, bars: 8 });
    return generateMelody({
      rng: makeRng(seed + 1000),
      plan,
      scale: SCALES.bilahari,
      ...(withPaths ? { paths } : {}),
    });
  }

  it("rises on the arohana and falls on the avarohana, for any seed", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), (seed) => {
        // On a weak beat nothing competes with the grammar, so it must hold absolutely.
        const strayOnWeakBeat = offPath(melody(seed, true), SCALES.bilahari).filter(
          (n) => !n.strong,
        );
        expect(strayOnWeakBeat).toEqual([]);
      }),
      { numRuns: 250 },
    );
  });

  it("is what puts the line on the path — the same raga without it wanders off", () => {
    // Bilahari's whole identity is the M1 and N3 it may only touch coming down. Without
    // the paths it is just major, and the lead climbs through them freely.
    let free = 0;
    for (let seed = 0; seed < 60; seed++)
      free += offPath(melody(seed, false), SCALES.bilahari).length;
    expect(free).toBeGreaterThan(0);
    let bound = 0;
    for (let seed = 0; seed < 60; seed++)
      bound += offPath(melody(seed, true), SCALES.bilahari).length;
    expect(bound).toBe(0);
  });

  it("states the theme on the path too, however the theme was developed", () => {
    // A transformed motif (here mirrored) arrives with its own contour; stating it must
    // still land the notes where the raga allows them.
    const plan = generateHarmony({ rng: makeRng(4), scale: SCALES.major, bars: 8 });
    const motif = generateMelody({
      rng: makeRng(5),
      plan: { ...plan, bars: plan.bars.slice(0, 2) },
      scale: SCALES.bilahari,
    });
    const pivot = motif[0]!.degree;
    const mirrored = motif.map((n) => ({ ...n, degree: 2 * pivot - n.degree }));
    const notes = generateMelody({
      rng: makeRng(6),
      plan,
      scale: SCALES.bilahari,
      paths,
      motif: mirrored,
      motifBars: 2,
    });
    expect(offPath(notes, SCALES.bilahari).filter((n) => !n.strong)).toEqual([]);
  });

  it("shapes the line but never strands it: an impossible ascent still sings", () => {
    // Only the tonic may be climbed to — the grammar has nowhere legal to go, and the
    // melody must fall back rather than stall or emit nothing.
    const plan = generateHarmony({ rng: makeRng(7), scale: SCALES.major, bars: 8 });
    const notes = generateMelody({
      rng: makeRng(8),
      plan,
      scale: SCALES.major,
      paths: { up: [0], down: SCALES.major },
    });
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(Number.isInteger(n.degree)).toBe(true);
  });

  it("leaves a raga that moves alike both ways exactly as it was", () => {
    const plain = melody(11, false);
    const symmetric = generateMelody({
      rng: makeRng(11 + 1000),
      plan: generateHarmony({ rng: makeRng(11), scale: SCALES.major, bars: 8 }),
      scale: SCALES.bilahari,
      paths: { up: SCALES.bilahari, down: SCALES.bilahari },
    });
    expect(symmetric).toEqual(plain);
  });
});
