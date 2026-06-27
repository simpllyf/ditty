import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_LEAP, DEFAULT_MAX_NOTE_REPEAT, isStableDegree } from "../src/constraints";
import { DEFAULT_RHYTHM } from "../src/rhythm";
import { makeRng } from "../src/rng";
import { SCALES, type Scale, degreeToSemitone } from "../src/scale";
import { MelodyStream, type MelodyOptions, type NoteEvent } from "../src/melody";

const ROOT = 72;
const BEATS_PER_BAR = DEFAULT_RHYTHM.beatsPerBar;
const WHOLE_TONE: Scale = [0, 2, 4, 6, 8, 10];

const byStart = (a: NoteEvent, b: NoteEvent) => a.startBeat - b.startBeat;

/** Collect `bars` units from a fresh stream seeded with `seed`. */
function run(seed: number, bars: number, opts: Record<string, unknown> = {}): NoteEvent[][] {
  const stream = new MelodyStream({ rng: makeRng(seed), rootMidi: ROOT, ...opts });
  return Array.from({ length: bars }, () => stream.next());
}

const lead = (bar: NoteEvent[]) =>
  bar.filter((e) => e.voice === "lead").sort((a, b) => a.startBeat - b.startBeat);

/** Recover the semitone offset from the root for a frequency. */
function semitoneFromRoot(freq: number, rootMidi = ROOT): number {
  return Math.round(69 + 12 * Math.log2(freq / 440)) - rootMidi;
}

/** Invert a frequency back to its scale degree (the degree map is strictly increasing). */
function degreeOf(scale: Scale, freq: number, rootMidi = ROOT): number | null {
  const semitone = semitoneFromRoot(freq, rootMidi);
  for (let d = -200; d <= 200; d++) {
    if (degreeToSemitone(scale, d) === semitone) return d;
  }
  return null;
}

function pitchClassesOf(scale: Scale): Set<number> {
  return new Set(scale.map((s) => ((s % 12) + 12) % 12));
}

describe("MelodyStream — §11 invariants (any seed)", () => {
  it("every note (lead, bass, arp) is a pitch of the chosen scale", () => {
    const allowed = pitchClassesOf(SCALES.majorPentatonic);
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        for (const bar of run(seed, 8)) {
          for (const note of bar) {
            const pc = ((semitoneFromRoot(note.frequency) % 12) + 12) % 12;
            expect(allowed.has(pc)).toBe(true);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("each bar's lead durations sum exactly to the bar length", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        for (const bar of run(seed, 8)) {
          const total = lead(bar).reduce((a, e) => a + e.durationBeats, 0);
          expect(total).toBeCloseTo(BEATS_PER_BAR, 9);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("no lead leap exceeds the cap (across the whole line, including bar joins)", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const degrees = run(seed, 8)
          .flatMap(lead)
          .map((note) => degreeOf(SCALES.majorPentatonic, note.frequency));
        expect(degrees.every((d) => d !== null)).toBe(true);
        for (let i = 1; i < degrees.length; i++) {
          expect(Math.abs(degrees[i]! - degrees[i - 1]!)).toBeLessThanOrEqual(DEFAULT_MAX_LEAP);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("every bar resolves its last lead note onto a stable tone", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        for (const bar of run(seed, 8)) {
          const notes = lead(bar);
          const last = notes[notes.length - 1]!;
          const degree = degreeOf(SCALES.majorPentatonic, last.frequency);
          expect(degree).not.toBeNull();
          expect(isStableDegree(SCALES.majorPentatonic, degree!)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("no lead note repeats more than the cap consecutively", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const degrees = run(seed, 12)
          .flatMap(lead)
          .map((e) => degreeOf(SCALES.majorPentatonic, e.frequency));
        expect(degrees.every((d) => d !== null)).toBe(true);
        let run_ = 0;
        let prev: number | null = null;
        for (const d of degrees) {
          run_ = d === prev ? run_ + 1 : 1;
          expect(run_).toBeLessThanOrEqual(DEFAULT_MAX_NOTE_REPEAT);
          prev = d;
        }
      }),
      { numRuns: 200 },
    );
  });

  it("does not stale-loop: phrases never repeat >2x in a row, with broad variety (any seed)", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const signatures = run(seed, 64).map((bar) =>
          lead(bar)
            .map((e) => `${degreeOf(SCALES.majorPentatonic, e.frequency)}:${e.durationBeats}`)
            .join(","),
        );
        let maxRun = 1;
        let cur = 1;
        for (let i = 1; i < signatures.length; i++) {
          cur = signatures[i] === signatures[i - 1] ? cur + 1 : 1;
          maxRun = Math.max(maxRun, cur);
        }
        expect(maxRun).toBeLessThanOrEqual(2);
        expect(new Set(signatures).size).toBeGreaterThan(20); // lots of distinct phrases
      }),
      { numRuns: 50 },
    );
  });

  it("velocities stay within 0..1 and start beats are non-decreasing", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        let lastStart = -1;
        for (const bar of run(seed, 6)) {
          for (let i = 1; i < bar.length; i++) {
            expect(bar[i]!.startBeat).toBeGreaterThanOrEqual(bar[i - 1]!.startBeat); // sorted
          }
          for (const note of bar) {
            expect(note.velocity).toBeGreaterThanOrEqual(0);
            expect(note.velocity).toBeLessThanOrEqual(1);
            expect(note.startBeat).toBeGreaterThanOrEqual(lastStart);
          }
          lastStart = bar[0]!.startBeat;
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("MelodyStream — §11 invariants across a matrix of valid configs", () => {
  // The invariants must hold for any seed AND any valid config, not just the
  // defaults — this exercises the resolveStable/avoidStaleRepeat paths that the
  // default config never reaches.
  const CONFIGS: Array<[string, Partial<MelodyOptions>]> = [
    ["major scale", { scale: SCALES.major }],
    ["major, wide range", { scale: SCALES.major, range: [-3, 10] }],
    ["pentatonic, wide range", { range: [-5, 9] }],
    ["tight leap (maxLeap 2)", { maxLeap: 2 }],
    ["no repeats (maxNoteRepeat 1)", { maxNoteRepeat: 1 }],
    ["low register (rootMidi 60)", { rootMidi: 60 }],
    ["lead only", { bass: false, arp: false }],
    [
      "3/4 time",
      { rhythm: { stepsPerBeat: 4, beatsPerBar: 3, durations: DEFAULT_RHYTHM.durations } },
    ],
  ];

  it.each(CONFIGS)("%s", (_name, cfg) => {
    const scale = cfg.scale ?? SCALES.majorPentatonic;
    const rootMidi = cfg.rootMidi ?? ROOT;
    const maxLeap = cfg.maxLeap ?? DEFAULT_MAX_LEAP;
    const maxRepeat = cfg.maxNoteRepeat ?? DEFAULT_MAX_NOTE_REPEAT;
    const beats = (cfg.rhythm ?? DEFAULT_RHYTHM).beatsPerBar;
    const allowed = pitchClassesOf(scale);

    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const stream = new MelodyStream({ rng: makeRng(seed), rootMidi, ...cfg });
        const bars = Array.from({ length: 6 }, () => stream.next());

        for (const bar of bars) {
          for (const note of bar) {
            const pc = ((semitoneFromRoot(note.frequency, rootMidi) % 12) + 12) % 12;
            expect(allowed.has(pc)).toBe(true); // in-scale
          }
          const leadNotes = bar.filter((e) => e.voice === "lead").sort(byStart);
          expect(leadNotes.reduce((a, e) => a + e.durationBeats, 0)).toBeCloseTo(beats, 9);
          const lastDegree = degreeOf(scale, leadNotes[leadNotes.length - 1]!.frequency, rootMidi);
          expect(lastDegree).not.toBeNull();
          expect(isStableDegree(scale, lastDegree!)).toBe(true); // resolves to stable
        }

        const degrees = bars
          .flatMap((b) => b.filter((e) => e.voice === "lead").sort(byStart))
          .map((e) => degreeOf(scale, e.frequency, rootMidi));
        expect(degrees.every((d) => d !== null)).toBe(true);
        for (let i = 1; i < degrees.length; i++) {
          expect(Math.abs(degrees[i]! - degrees[i - 1]!)).toBeLessThanOrEqual(maxLeap);
        }
        let runLen = 0;
        let prev: number | null = null;
        for (const d of degrees) {
          runLen = d === prev ? runLen + 1 : 1;
          expect(runLen).toBeLessThanOrEqual(maxRepeat);
          prev = d;
        }
      }),
      { numRuns: 50 },
    );
  });
});

describe("MelodyStream — determinism", () => {
  it("same seed → identical event stream", () => {
    expect(run(2024, 16)).toEqual(run(2024, 16));
  });

  it("different seeds → different streams", () => {
    expect(run(1, 16)).not.toEqual(run(2, 16));
  });

  it("matches a committed golden snapshot", () => {
    expect(run(42, 4)).toMatchSnapshot();
  });
});

describe("MelodyStream — structure & layers", () => {
  it("advances by one bar per next()", () => {
    const bars = run(7, 4);
    bars.forEach((bar, i) => {
      expect(bar[0]!.startBeat).toBe(i * BEATS_PER_BAR);
    });
  });

  it("includes bass and arp by default, and omits them when disabled", () => {
    const withLayers = run(7, 8).flat();
    expect(withLayers.some((e) => e.voice === "bass")).toBe(true);
    expect(withLayers.some((e) => e.voice === "arp")).toBe(true);

    const leadOnly = run(7, 8, { bass: false, arp: false }).flat();
    expect(leadOnly.every((e) => e.voice === "lead")).toBe(true);
  });

  it("works on the major scale too (all notes in scale)", () => {
    const allowed = pitchClassesOf(SCALES.major);
    for (const bar of run(99, 8, { scale: SCALES.major })) {
      for (const note of bar) {
        const pc = ((semitoneFromRoot(note.frequency) % 12) + 12) % 12;
        expect(allowed.has(pc)).toBe(true);
      }
    }
  });
});

describe("MelodyStream — validation", () => {
  it("rejects malformed numeric options", () => {
    expect(() => new MelodyStream({ rng: makeRng(1), range: [5, 2] })).toThrow(RangeError);
    expect(() => new MelodyStream({ rng: makeRng(1), maxLeap: 0 })).toThrow(RangeError);
    expect(() => new MelodyStream({ rng: makeRng(1), maxNoteRepeat: 0 })).toThrow(RangeError);
    expect(() => new MelodyStream({ rng: makeRng(1), contourAmplitude: -1 })).toThrow(RangeError);
  });

  it("rejects a single-degree range (no room for motion or anti-repeat)", () => {
    expect(() => new MelodyStream({ rng: makeRng(1), range: [3, 3] })).toThrow(RangeError);
  });

  it("rejects a range/scale that can't resolve every phrase to a stable tone", () => {
    // major degrees 5 (pc9) and 6 (pc11) are both unstable → no stable tone in range.
    expect(() => new MelodyStream({ rng: makeRng(1), scale: SCALES.major, range: [5, 6] })).toThrow(
      RangeError,
    );
    // major with maxLeap 1: from degree 5, the only in-range stable (7) is 2 away.
    expect(
      () => new MelodyStream({ rng: makeRng(1), scale: SCALES.major, range: [5, 7], maxLeap: 1 }),
    ).toThrow(RangeError);
  });

  it("rejects a scale lacking the chord tones the bass/arp layers need", () => {
    // whole-tone has no perfect fifth (pc 7).
    expect(() => new MelodyStream({ rng: makeRng(1), scale: WHOLE_TONE })).toThrow(RangeError);
  });

  it("supports such a scale when bass and arp are disabled (all notes still in scale)", () => {
    const allowed = pitchClassesOf(WHOLE_TONE);
    for (const bar of run(3, 6, { scale: WHOLE_TONE, bass: false, arp: false })) {
      for (const note of bar) {
        const pc = ((semitoneFromRoot(note.frequency) % 12) + 12) % 12;
        expect(allowed.has(pc)).toBe(true);
      }
    }
  });
});
