import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ScoreVoice, arrange } from "../src/compose/arranger";
import { makeRng } from "../src/rng";
import { midiToFrequency } from "../src/theory/pitch";
import { SCALES } from "../src/theory/scales";

const DEFAULT_ROOT = 60;

function arr(o: { seed?: number; bars?: number; [k: string]: unknown } = {}) {
  const { seed = 1, bars = 8, ...rest } = o;
  return arrange({ rng: makeRng(seed), parent: SCALES.major, raga: SCALES.mohanam, bars, ...rest });
}

const part = (score: ReturnType<typeof arr>, voice: ScoreVoice) =>
  score.parts.find((p) => p.voice === voice);

const freqToPc = (freq: number, rootMidi: number) =>
  (((Math.round(69 + 12 * Math.log2(freq / 440)) - rootMidi) % 12) + 12) % 12;

describe("arrange — score shape & bounds", () => {
  it("emits well-formed, in-bounds notes for any seed / swing / meter", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom(3, 4),
        (seed, swing, beatsPerBar) => {
          const score = arr({ seed, swing, beatsPerBar });
          expect(score.lengthBeats).toBe(score.bars * score.beatsPerBar);
          const allNotes = score.parts.flatMap((p) => p.notes);
          for (const n of allNotes) {
            expect(n.startBeat).toBeGreaterThanOrEqual(0);
            expect(n.startBeat).toBeLessThan(score.lengthBeats);
            expect(n.startBeat + n.durationBeats).toBeLessThanOrEqual(score.lengthBeats + 1e-9);
            expect(n.durationBeats).toBeGreaterThan(0);
            expect(n.velocity).toBeGreaterThan(0);
            expect(n.velocity).toBeLessThanOrEqual(1);
            expect(Number.isFinite(n.freq)).toBe(true);
            expect(n.freq).toBeGreaterThan(20);
            expect(n.freq).toBeLessThan(8000);
          }
          for (const h of score.drums) {
            expect(h.startBeat).toBeGreaterThanOrEqual(0);
            expect(h.startBeat).toBeLessThan(score.lengthBeats);
            expect(h.velocity).toBeGreaterThan(0);
            expect(h.velocity).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it("plumbs bpm / beatsPerBar / bars", () => {
    const score = arr({ seed: 2, bpm: 128, beatsPerBar: 3, bars: 6 });
    expect(score.bpm).toBe(128);
    expect(score.beatsPerBar).toBe(3);
    expect(score.bars).toBe(6);
    expect(score.lengthBeats).toBe(18);
  });
});

describe("arrange — voices & registers", () => {
  it("includes all voices and drums by default, in a stable order", () => {
    const score = arr({ seed: 3 });
    expect(score.parts.map((p) => p.voice)).toEqual(["lead", "bass", "pad", "arp"]);
    expect(score.drums.length).toBeGreaterThan(0);
  });

  it("disabling a voice removes its part; drums:false silences drums", () => {
    const score = arr({ seed: 3, voices: { pad: false, arp: false, drums: false } });
    expect(score.parts.map((p) => p.voice)).toEqual(["lead", "bass"]);
    expect(score.drums).toEqual([]);
  });

  it("all voices off → a valid, empty arrangement (deterministic silence)", () => {
    const score = arr({
      seed: 3,
      voices: { lead: false, bass: false, pad: false, arp: false, drums: false },
    });
    expect(score.parts).toEqual([]);
    expect(score.drums).toEqual([]);
    expect(score.lengthBeats).toBe(32);
  });

  it("keeps bass below the pad (the fifth never leaps into the pad octave)", () => {
    const score = arr({ seed: 7 });
    const bassMax = Math.max(...part(score, "bass")!.notes.map((n) => n.freq));
    const padMin = Math.min(...part(score, "pad")!.notes.map((n) => n.freq));
    expect(bassMax).toBeLessThan(padMin);
  });

  it("places each voice in its register and on the right pitches", () => {
    const score = arr({ seed: 7 });
    const ragaPcs = new Set(SCALES.mohanam.map((s) => ((s % 12) + 12) % 12));
    for (const n of part(score, "lead")!.notes) {
      expect(ragaPcs.has(freqToPc(n.freq, DEFAULT_ROOT))).toBe(true); // lead ∈ raga
    }
    for (const n of part(score, "bass")!.notes) {
      expect(n.freq).toBeLessThanOrEqual(midiToFrequency(DEFAULT_ROOT - 1)); // low octave
    }
    for (const n of part(score, "pad")!.notes) {
      expect(n.freq).toBeGreaterThanOrEqual(midiToFrequency(DEFAULT_ROOT));
      expect(n.freq).toBeLessThanOrEqual(midiToFrequency(DEFAULT_ROOT + 11));
    }
    for (const n of part(score, "arp")!.notes) {
      expect(n.freq).toBeGreaterThanOrEqual(midiToFrequency(DEFAULT_ROOT + 12)); // high octave
    }
  });

  it("plays the chord root on the bass downbeat (matches the pad's root per bar)", () => {
    const score = arr({ seed: 7 });
    const bass = part(score, "bass")!.notes;
    const pad = part(score, "pad")!.notes;
    for (let bar = 0; bar < score.bars; bar++) {
      const at = bar * score.beatsPerBar;
      const bassDown = bass.find((n) => n.startBeat === at)!;
      const padRoot = pad.find((n) => n.startBeat === at)!; // pad emits chord.pcs root-first
      expect(freqToPc(bassDown.freq, DEFAULT_ROOT)).toBe(freqToPc(padRoot.freq, DEFAULT_ROOT));
    }
  });

  it("defaults the lead raga to the parent scale when none is given", () => {
    const score = arrange({ rng: makeRng(3), parent: SCALES.major, bars: 8 });
    const majorPcs = new Set(SCALES.major.map((s) => ((s % 12) + 12) % 12));
    for (const n of part(score, "lead")!.notes) {
      expect(majorPcs.has(freqToPc(n.freq, DEFAULT_ROOT))).toBe(true);
    }
  });

  it("uses the accent scheme kick=1 > snare=0.9 > hat=0.45", () => {
    const score = arr({ seed: 1 });
    const vels = (d: string) => [
      ...new Set(score.drums.filter((h) => h.drum === d).map((h) => h.velocity)),
    ];
    expect(vels("kick")).toEqual([1]);
    expect(vels("snare")).toEqual([0.9]);
    expect(vels("hat")).toEqual([0.45]);
  });
});

describe("arrange — harmony passthrough", () => {
  const padOnly = { voices: { lead: false, bass: false, arp: false, drums: false } };
  const padFreqs = (o: object) => part(arr({ seed: 1, ...o }), "pad")!.notes.map((n) => n.freq);

  it("forwards an explicit progression, and functional generation differs from the library pick", () => {
    expect(padFreqs({ ...padOnly, progression: [0, 3, 4, 5] })).not.toEqual(
      padFreqs({ ...padOnly, progression: [0, 1, 2, 3] }),
    );
    expect(padFreqs({ ...padOnly })).not.toEqual(
      padFreqs({ ...padOnly, generateProgression: true }),
    );
  });
});

describe("arrange — determinism & isolation", () => {
  it("is deterministic for the same options", () => {
    expect(arr({ seed: 5 })).toEqual(arr({ seed: 5 }));
  });

  it("retuning the lead (density) leaves the other voices untouched", () => {
    const a = arr({ seed: 5, density: 0.2 });
    const b = arr({ seed: 5, density: 0.9 });
    expect(part(a, "lead")).not.toEqual(part(b, "lead"));
    expect(part(a, "bass")).toEqual(part(b, "bass"));
    expect(part(a, "pad")).toEqual(part(b, "pad"));
    expect(part(a, "arp")).toEqual(part(b, "arp"));
    expect(a.drums).toEqual(b.drums);
  });

  it("toggling a voice off leaves every other voice byte-identical", () => {
    const all: ScoreVoice[] = ["lead", "bass", "pad", "arp"];
    const full = arr({ seed: 11 });
    for (const off of all) {
      const partial = arr({ seed: 11, voices: { [off]: false } });
      for (const v of all) {
        if (v === off) continue;
        expect(part(partial, v)).toEqual(part(full, v));
      }
      expect(partial.drums).toEqual(full.drums); // disabling a pitched voice never shifts drums
    }
  });
});

describe("arrange — swing", () => {
  it("delays offbeat hats without dropping or reordering them", () => {
    const straight = arr({ seed: 8, swing: 0 });
    const swung = arr({ seed: 8, swing: 0.6 });
    expect(swung.drums.length).toBe(straight.drums.length);
    const offbeatHats = straight.drums.filter((h) => h.drum === "hat" && h.startBeat % 1 === 0.5);
    expect(offbeatHats.length).toBeGreaterThan(0);
    for (let i = 0; i < straight.drums.length; i++) {
      const s = straight.drums[i]!;
      const w = swung.drums[i]!;
      const isOffbeatHat = s.drum === "hat" && s.startBeat % 1 === 0.5;
      const moved = isOffbeatHat ? w.startBeat > s.startBeat : w.startBeat === s.startBeat;
      expect(w.drum === s.drum && moved).toBe(true);
    }
  });

  it("delays offbeat lead and arp notes too (swing isn't drums-only)", () => {
    const straight = arr({ seed: 8, swing: 0 });
    const swung = arr({ seed: 8, swing: 0.6 });
    for (const v of ["lead", "arp"] as ScoreVoice[]) {
      const s = part(straight, v)!.notes;
      const w = part(swung, v)!.notes;
      expect(w.length).toBe(s.length); // swing shifts time, never adds/drops notes
      let moved = 0;
      for (let i = 0; i < s.length; i++) {
        const isOffbeat = s[i]!.startBeat % 1 === 0.5;
        const ok = isOffbeat
          ? w[i]!.startBeat > s[i]!.startBeat
          : w[i]!.startBeat === s[i]!.startBeat;
        expect(ok).toBe(true);
        if (isOffbeat) moved++;
      }
      expect(moved).toBeGreaterThan(0);
    }
  });
});

describe("arrange — golden & validation", () => {
  it("matches a committed structural golden", () => {
    const score = arr({ seed: 42, bars: 8, raga: SCALES.mohanam });
    const round2 = (x: number) => Math.round(x * 100) / 100;
    const summary = {
      bpm: score.bpm,
      beatsPerBar: score.beatsPerBar,
      bars: score.bars,
      lengthBeats: score.lengthBeats,
      rootMidi: score.rootMidi,
      parts: score.parts.map((p) => ({
        voice: p.voice,
        count: p.notes.length,
        first3: p.notes.slice(0, 3).map((n) => ({
          startBeat: round2(n.startBeat),
          durationBeats: round2(n.durationBeats),
          freq: round2(n.freq),
          velocity: round2(n.velocity),
        })),
      })),
      drums: (["kick", "snare", "hat"] as const).map((d) => ({
        drum: d,
        count: score.drums.filter((h) => h.drum === d).length,
      })),
    };
    expect(summary).toMatchSnapshot();
  });

  it("rejects bad options", () => {
    const rng = makeRng(1);
    expect(() => arrange({ rng, bpm: 0 })).toThrow(RangeError);
    expect(() => arrange({ rng, swing: 1.5 })).toThrow(RangeError);
    expect(() => arrange({ rng, density: Number.NaN })).toThrow(RangeError);
    expect(() => arrange({ rng, rootMidi: 12 })).toThrow(RangeError);
    expect(() => arrange({ rng, rootMidi: 60.5 })).toThrow(RangeError);
    // @ts-expect-error invalid groove name
    expect(() => arrange({ rng, groove: "nope" })).toThrow(RangeError);
    expect(() => arrange({ rng, bars: 2 })).toThrow(RangeError); // delegated to generateHarmony
  });

  it("arpRole orchestrates the arp: arpeggio (default), tutti double, or harmony", () => {
    const o = { bars: 8, beatsPerBar: 4 } as const;
    const arpNotes = (role?: "double" | "harmony") =>
      part(arrange({ rng: makeRng(1), ...o, ...(role ? { arpRole: role } : {}) }), "arp")!.notes;
    const lead = part(arrange({ rng: makeRng(1), ...o }), "lead")!.notes; // arpRole doesn't touch the lead
    expect(arpNotes().length).toBe(8 * 4 * 2); // default arpeggio: eighth notes across the loop
    // double: one note per lead note, an octave above the lead (a tutti)
    const dbl = arpNotes("double");
    expect(dbl.map((n) => n.startBeat)).toEqual(lead.map((n) => n.startBeat));
    for (let i = 0; i < dbl.length; i++) expect(dbl[i]!.freq).toBeCloseTo(lead[i]!.freq * 2, 4);
    // harmony: same rhythm as the lead, sitting below it (a third under)
    const harm = arpNotes("harmony");
    expect(harm.length).toBe(lead.length);
    for (let i = 0; i < harm.length; i++) expect(harm[i]!.freq).toBeLessThan(lead[i]!.freq);
  });

  it("dynamics scales every velocity (clamped); fill reworks only the last bar", () => {
    const o = { bars: 8, beatsPerBar: 4 } as const;
    const base = arrange({ rng: makeRng(1), ...o });
    // explicit defaults are byte-identical to a bare arrange()
    expect(arrange({ rng: makeRng(1), ...o, dynamics: 1, fill: false })).toEqual(base);
    // dynamics < 1 scales note velocities down
    const soft = arrange({ rng: makeRng(1), ...o, dynamics: 0.5 });
    const leadVel = (s: ReturnType<typeof arrange>) =>
      part(s, "lead")!.notes.map((n) => n.velocity);
    expect(leadVel(soft)).toEqual(leadVel(base).map((v) => v * 0.5));
    // dynamics > 1 never exceeds 1
    const loud = arrange({ rng: makeRng(1), ...o, dynamics: 2 });
    for (const p of loud.parts) for (const n of p.notes) expect(n.velocity).toBeLessThanOrEqual(1);
    // fill: the last bar becomes a snare buildup + kick downbeat; earlier bars untouched
    const filled = arrange({ rng: makeRng(1), ...o, fill: true });
    const lastBar = 7 * 4;
    const tail = filled.drums.filter((h) => h.startBeat >= lastBar);
    expect(tail.filter((h) => h.drum === "snare").length).toBe(8); // 8th-note roll
    expect(tail.some((h) => h.drum === "kick" && h.startBeat === lastBar)).toBe(true);
    expect(filled.drums.filter((h) => h.startBeat < lastBar)).toEqual(
      base.drums.filter((h) => h.startBeat < lastBar),
    );
  });

  it("bass patterns vary the low-end shape; default is rootFifth (unchanged)", () => {
    const o = { bars: 8, beatsPerBar: 4 } as const;
    const bass = (p?: "rootFifth" | "walking" | "pulse" | "sustained") =>
      part(arrange({ rng: makeRng(1), ...o, ...(p ? { bassPattern: p } : {}) }), "bass")!.notes;
    expect(bass()).toEqual(bass("rootFifth")); // default === rootFifth, byte-identical
    expect(bass("rootFifth").length).toBe(8 * 2);
    expect(bass("pulse").length).toBe(8 * 4); // a hit every beat
    expect(bass("walking").length).toBe(8 * 4);
    expect(bass("sustained").length).toBe(8); // one held note per bar
    for (const n of bass("walking")) expect(n.freq).toBeLessThan(midiToFrequency(DEFAULT_ROOT)); // stays under the pad
  });

  it("texture gates the arp/drums by section (dynamic arc); full leaves them intact", () => {
    const opts = { bars: 8, beatsPerBar: 4 } as const; // lengthBeats 32 → sections of 8 beats
    const full = arrange({ rng: makeRng(1), ...opts, texture: "full" });
    const build = arrange({ rng: makeRng(1), ...opts, texture: "build" }); // arp [0,0,1,1] drums [0,1,1,1]
    const arp = (s: ReturnType<typeof arrange>) => part(s, "arp")!.notes;
    const inSec0 = (beats: readonly { startBeat: number }[]) =>
      beats.filter((n) => n.startBeat < 8);
    // lead/pad/bass are never gated — identical across textures
    expect(part(build, "lead")!.notes).toEqual(part(full, "lead")!.notes);
    expect(part(build, "pad")!.notes).toEqual(part(full, "pad")!.notes);
    // arp + drums: present in section 0 for full, gated out for build
    expect(inSec0(arp(full)).length).toBeGreaterThan(0);
    expect(inSec0(arp(build)).length).toBe(0);
    expect(inSec0(full.drums).length).toBeGreaterThan(0);
    expect(inSec0(build.drums).length).toBe(0);
  });

  it("keeps the bass in key over diminished chords (no blind perfect fifth)", () => {
    // progression hits vii° (degree 6 = a diminished triad in major); the bass's
    // alternating fifth must be the chord's real fifth, not a perfect fifth (out of key).
    const inKey = new Set(SCALES.major.map((s) => ((s % 12) + 12) % 12));
    for (let seed = 0; seed < 30; seed++) {
      const score = arrange({
        rng: makeRng(seed),
        parent: SCALES.major,
        raga: SCALES.major,
        progression: [0, 6, 4, 5],
        bars: 8,
      });
      for (const n of part(score, "bass")!.notes) {
        expect(inKey.has(freqToPc(n.freq, DEFAULT_ROOT))).toBe(true);
      }
    }
  });

  it("rejects a raga that isn't a pitch-class subset of the parent", () => {
    const rng = makeRng(1);
    // hindolam has b6 (pc 8), which major lacks → out of key.
    expect(() => arrange({ rng, parent: SCALES.major, raga: SCALES.hindolam })).toThrow(RangeError);
    // a valid subset pairing is accepted.
    expect(() => arrange({ rng, parent: SCALES.major, raga: SCALES.mohanam })).not.toThrow();
  });
});
