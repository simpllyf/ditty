import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PART_ARRANGERS, type ScoreVoice, arrange, thirdBelow } from "../src/compose/arranger";
import { generateHarmony } from "../src/compose/harmony";
import { makeRng } from "../src/rng";
import { makeChord } from "../src/theory/chords";
import { midiToFrequency } from "../src/theory/pitch";
import { DRUM_GROOVES } from "../src/theory/rhythm";
import { SCALES, type Scale, degreeToSemitone } from "../src/theory/scales";

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

  it("the 'counter' arp role weaves a moving chord-tone line beneath the lead", () => {
    const score = arrange({
      rng: makeRng(7),
      parent: SCALES.major,
      raga: SCALES.mohanam,
      bars: 8,
      beatsPerBar: 4,
      arpRole: "counter",
    });
    const mean = (ns: readonly { freq: number }[]) =>
      ns.reduce((s, n) => s + n.freq, 0) / ns.length;
    const lead = score.parts.find((p) => p.voice === "lead")!.notes;
    const counter = score.parts.find((p) => p.voice === "arp")!.notes;
    expect(counter.length).toBeGreaterThan(0);
    expect(counter.every((n) => Number.isFinite(n.freq))).toBe(true);
    expect(mean(counter)).toBeLessThan(mean(lead)); // sits under the lead's soprano
    const semis = counter.map((n) => Math.round(12 * Math.log2(n.freq / 261.6256)));
    expect(new Set(semis).size).toBeGreaterThan(1); // it actually moves (not a pedal)
    for (let i = 1; i < semis.length; i++) {
      expect(Math.abs(semis[i]! - semis[i - 1]!)).toBeLessThanOrEqual(7); // stays within a fifth — smooth
    }
  });

  it("the counter voice answers the lead's breaths and moves against it", () => {
    let answered = 0;
    let breaths = 0;
    let contrary = 0;
    let moves = 0;
    for (let seed = 1; seed < 30; seed++) {
      const score = arrange({
        rng: makeRng(seed),
        parent: SCALES.major,
        raga: SCALES.mohanam,
        bars: 8,
        beatsPerBar: 4,
        arpRole: "counter",
      });
      const lead = [...part(score, "lead")!.notes].sort((a, b) => a.startBeat - b.startBeat);
      const counter = [...part(score, "arp")!.notes].sort((a, b) => a.startBeat - b.startBeat);
      const semis = (f: number) => 12 * Math.log2(f / 261.6256);
      // A real breath in the line — the silence an answering voice exists to fill.
      for (let i = 1; i < lead.length; i++) {
        const end = lead[i - 1]!.startBeat + lead[i - 1]!.durationBeats;
        if (lead[i]!.startBeat - end < 1) continue;
        breaths++;
        if (counter.some((n) => n.startBeat >= end - 1e-9 && n.startBeat < lead[i]!.startBeat)) {
          answered++;
        }
      }
      for (let i = 1; i < counter.length; i++) {
        const at = counter[i]!.startBeat;
        const before = lead.filter((n) => n.startBeat <= at);
        if (before.length < 2) continue;
        const dLead =
          semis(before[before.length - 1]!.freq) - semis(before[before.length - 2]!.freq);
        const dCounter = semis(counter[i]!.freq) - semis(counter[i - 1]!.freq);
        if (dLead === 0 || dCounter === 0) continue;
        moves++;
        if (Math.sign(dLead) !== Math.sign(dCounter)) contrary++;
      }
    }
    expect(breaths).toBeGreaterThan(20); // the sample really does contain breaths
    expect(answered / breaths).toBeGreaterThan(0.5); // …and most of them get an answer
    expect(moves).toBeGreaterThan(20);
    expect(contrary / moves).toBeGreaterThan(0.65); // two lines, not one harmonised line
  });

  it("arranges valid music in 3/4 (waltz) and 6/8 (sixEight) — nothing spills past the loop", () => {
    for (const groove of ["waltz", "sixEight"] as const) {
      const bpb = DRUM_GROOVES[groove].beatsPerBar;
      const score = arrange({
        rng: makeRng(3),
        parent: SCALES.major,
        raga: SCALES.mohanam,
        bars: 6,
        beatsPerBar: bpb,
        groove,
      });
      expect(score.beatsPerBar).toBe(bpb);
      const loopBeats = score.bars * bpb;
      for (const p of score.parts) {
        for (const n of p.notes) {
          expect(Number.isFinite(n.freq)).toBe(true);
          expect(n.startBeat).toBeGreaterThanOrEqual(0);
          expect(n.startBeat + n.durationBeats).toBeLessThanOrEqual(loopBeats + 1e-9);
        }
      }
      for (const h of score.drums) {
        expect(h.startBeat).toBeGreaterThanOrEqual(0);
        expect(h.startBeat).toBeLessThan(loopBeats);
      }
    }
  });

  it("drives the ensemble from the PART_ARRANGERS registry, in registry order", () => {
    expect(PART_ARRANGERS.map((p) => p.voice)).toEqual(["lead", "bass", "pad", "arp"]);
    for (const p of PART_ARRANGERS) expect(typeof p.arrange).toBe("function");
    // the Score's parts follow the registry order, and a disabled voice just drops out
    expect(arr({ seed: 5 }).parts.map((p) => p.voice)).toEqual(PART_ARRANGERS.map((p) => p.voice));
    expect(arr({ seed: 5, voices: { bass: false } }).parts.map((p) => p.voice)).toEqual([
      "lead",
      "pad",
      "arp",
    ]);
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
      // Root-position voicing: the root sits in the tonic octave and the chord stacks
      // within an octave above it, so a tone can reach up to two octaves over the tonic.
      expect(n.freq).toBeGreaterThanOrEqual(midiToFrequency(DEFAULT_ROOT));
      expect(n.freq).toBeLessThanOrEqual(midiToFrequency(DEFAULT_ROOT + 22));
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

  it("voices the pad in root position — the chord root is the lowest tone, no inversions", () => {
    // IV, V, vi, vii° and borrowed ♭VII each have chord tones whose pitch class falls
    // below the root, so root-position voicing must stack them an octave up — the root
    // must still come out lowest. V (cadence) and IV recur in nearly every progression.
    const plan = {
      scale: SCALES.major,
      rootMidi: DEFAULT_ROOT,
      beatsPerBar: 4,
      bars: [
        { degree: 3, chord: makeChord(5, "major") }, // IV   = [5,9,0]
        { degree: 4, chord: makeChord(7, "major") }, // V    = [7,11,2]
        { degree: 5, chord: makeChord(9, "minor") }, // vi   = [9,0,4]
        { degree: 6, chord: makeChord(11, "diminished") }, // vii° = [11,2,5]
        { degree: 6, chord: makeChord(10, "major") }, // ♭VII = [10,2,5]
        { degree: 0, chord: makeChord(0, "major") }, // I    = [0,4,7]
      ],
      cadences: { half: 1, final: 5 },
    };
    const bars = plan.bars.length;
    const score = arrange({
      rng: makeRng(1),
      parent: SCALES.major,
      raga: SCALES.mohanam,
      bars,
      beatsPerBar: 4,
      plan,
      padPattern: "sustain",
    });
    const pad = part(score, "pad")!.notes;
    for (let bar = 0; bar < bars; bar++) {
      const barNotes = pad.filter((n) => n.startBeat === bar * 4);
      const lowest = barNotes.reduce((a, b) => (a.freq <= b.freq ? a : b));
      const top = Math.max(...barNotes.map((n) => n.freq));
      expect(freqToPc(lowest.freq, DEFAULT_ROOT)).toBe(plan.bars[bar]!.chord.root); // root on the bottom
      expect(12 * Math.log2(top / lowest.freq)).toBeLessThanOrEqual(12.001); // chord within an octave
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

  it("padPattern voices chords: sustained block (default), stabs, or broken", () => {
    const o = { bars: 8, beatsPerBar: 4 } as const;
    const pad = (p?: "stabs" | "broken") =>
      part(arrange({ rng: makeRng(1), ...o, ...(p ? { padPattern: p } : {}) }), "pad")!.notes;
    const base = pad();
    for (const n of base) expect(n.startBeat % 4).toBe(0); // sustain: block on each bar downbeat
    const stabs = pad("stabs");
    expect(stabs.length).toBeGreaterThan(base.length); // a chord on every beat
    expect(stabs.every((n) => n.durationBeats <= 0.4 + 1e-9)).toBe(true); // short hits
    const bar0 = pad("broken")
      .filter((n) => n.startBeat < 4)
      .map((n) => n.startBeat);
    expect(new Set(bar0).size).toBeGreaterThan(1); // broken: tones staggered across the bar
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

  it("thirdBelow harmonises a third — preferring a real third, never a second", () => {
    const interval = (scale: Scale, deg: number) =>
      degreeToSemitone(scale, deg) - degreeToSemitone(scale, thirdBelow(scale, deg));
    // heptatonic: every degree gets a genuine third (3–4 semitones)
    for (let deg = 0; deg <= 7; deg++) {
      expect(interval(SCALES.major, deg)).toBeGreaterThanOrEqual(3);
      expect(interval(SCALES.major, deg)).toBeLessThanOrEqual(4);
    }
    // pentatonic has gaps: a third where one exists, a fourth as fallback, never a second
    for (let deg = 0; deg < 5; deg++) {
      const semis = interval(SCALES.majorPentatonic, deg);
      expect(semis).toBeGreaterThanOrEqual(3); // not a second
      expect(semis).toBeLessThanOrEqual(5); // a third or (fallback) a fourth — controlled
    }
    // where a third exists it IS chosen (a fixed -2 degree shift would give a fourth here)
    expect(interval(SCALES.majorPentatonic, 3)).toBe(3); // minor third, not the old fourth
    expect(interval(SCALES.majorPentatonic, 0)).toBe(3); // minor third, not the old fourth
  });

  it("dynamics scales every velocity (clamped); fill reworks only the last bar", () => {
    const o = { bars: 8, beatsPerBar: 4 } as const;
    const base = arrange({ rng: makeRng(1), ...o });
    // explicit defaults match a bare arrange()
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
    expect(bass()).toEqual(bass("rootFifth")); // default is rootFifth
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

  it("develops a supplied theme, and states one whose span the caller left unsaid", () => {
    // A two-bar theme handed in bare: the arranger has to measure the span itself,
    // or the generated continuation starts on top of the theme instead of after it.
    const motif = [
      { startBeat: 0, durationBeats: 1, degree: 0, velocity: 0.7, strong: true },
      { startBeat: 1, durationBeats: 1, degree: 2, velocity: 0.7, strong: false },
      { startBeat: 4, durationBeats: 2, degree: 1, velocity: 0.7, strong: true },
    ];
    const lead = (o: Record<string, unknown>) =>
      part(arr({ voices: { lead: true }, ...o }), "lead")!;

    const bare = lead({ motif });
    const heads = bare.notes.filter((n) => n.startBeat < 8).map((n) => n.startBeat);
    expect(new Set(heads).size).toBe(heads.length); // no two notes share a start — nothing doubled up

    // The same theme, mirrored, is a different line — but still a line, not a dropped one.
    const mirrored = lead({
      motif,
      motifBars: 2,
      development: { transform: "inversion", step: 0 },
    });
    const plain = lead({ motif, motifBars: 2, development: { transform: "statement", step: 0 } });
    expect(mirrored.notes.length).toBeGreaterThan(0);
    expect(mirrored.notes.slice(0, 3).map((n) => n.freq)).not.toEqual(
      plain.notes.slice(0, 3).map((n) => n.freq),
    );
  });

  it("voices the pad from the chord and nothing else, whatever the voicing does", () => {
    // The guard for voice-leading: it may move a tone to another octave, never to
    // another NOTE. (Chord tones are pitch classes relative to the tonic — reading
    // them as absolute MIDI classes silently transposes every chord off a non-C tonic.)
    for (const rootMidi of [57, 60, 61, 64]) {
      const plan = generateHarmony({
        rng: makeRng(4),
        scale: SCALES.major,
        rootMidi,
        bars: 8,
        beatsPerBar: 4,
      });
      const score = arr({ seed: 4, rootMidi, bars: 8, beatsPerBar: 4, plan });
      const byBar = new Map<number, Set<number>>();
      for (const n of part(score, "pad")!.notes) {
        const bar = Math.floor(n.startBeat / 4);
        byBar.set(bar, (byBar.get(bar) ?? new Set()).add(freqToPc(n.freq, rootMidi)));
      }
      expect(byBar.size).toBe(8);
      for (const [bar, pcs] of byBar) {
        const chord = [...plan.bars[bar]!.chord.pcs].sort((x, y) => x - y);
        expect([...pcs].sort((x, y) => x - y)).toEqual(chord); // exactly this bar's chord
      }
    }
  });

  it("leads the pad's voices: common tones stay put and nothing leaps", () => {
    let motion = 0;
    let moves = 0;
    let heldCommon = 0;
    let common = 0;
    for (let seed = 1; seed < 25; seed++) {
      const score = arr({ seed, bars: 8 });
      const beatsPerBar = score.beatsPerBar;
      const byBar = new Map<number, Set<number>>();
      for (const n of part(score, "pad")!.notes) {
        const bar = Math.floor(n.startBeat / beatsPerBar);
        const midi = Math.round(69 + 12 * Math.log2(n.freq / 440));
        byBar.set(bar, (byBar.get(bar) ?? new Set()).add(midi));
      }
      const bars = [...byBar.keys()]
        .sort((a, b) => a - b)
        .map((b) => [...byBar.get(b)!].sort((x, y) => x - y));
      for (let b = 1; b < bars.length; b++) {
        const from = bars[b - 1]!;
        const to = bars[b]!;
        const pcsTo = new Set(to.map((m) => ((m % 12) + 12) % 12));
        for (const midi of from) {
          if (!pcsTo.has(((midi % 12) + 12) % 12)) continue;
          common++;
          if (to.includes(midi)) heldCommon++; // a shared tone should simply not move
        }
        for (let v = 0; v < Math.min(from.length, to.length); v++) {
          motion += Math.abs(to[v]! - from[v]!);
          moves++;
        }
      }
    }
    expect(common).toBeGreaterThan(50); // the sample actually exercises shared tones
    expect(heldCommon).toBe(common); // …and every one of them is held in place
    expect(motion / moves).toBeLessThan(2); // voices step, they don't lurch
  });

  it("rejects a raga that isn't a pitch-class subset of the parent", () => {
    const rng = makeRng(1);
    // hindolam has b6 (pc 8), which major lacks → out of key.
    expect(() => arrange({ rng, parent: SCALES.major, raga: SCALES.hindolam })).toThrow(RangeError);
    // a valid subset pairing is accepted.
    expect(() => arrange({ rng, parent: SCALES.major, raga: SCALES.mohanam })).not.toThrow();
  });
});
