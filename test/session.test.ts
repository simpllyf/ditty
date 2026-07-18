import { describe, expect, it } from "vitest";
import type { ScoreVoice } from "../src/compose/arranger";
import { createSession } from "../src/session";
import { STYLES } from "../src/styles";
import { SCALES } from "../src/theory/scales";

const VOICES: ScoreVoice[] = ["lead", "bass", "pad", "arp"];
const instrumentNames = (s: ReturnType<typeof createSession>) =>
  Object.fromEntries(VOICES.map((v) => [v, s.instruments[v].name]));

describe("createSession", () => {
  it("is deterministic for a seed", () => {
    const a = createSession({ seed: 1 });
    const b = createSession({ seed: 1 });
    expect(instrumentNames(a)).toEqual(instrumentNames(b));
    expect(a.bpm).toBe(b.bpm);
    expect(a.nextScore()).toEqual(b.nextScore());
  });

  it("evolve:false replays the form identically; evolve:true develops it", () => {
    const N = 16; // longer than any form template (max 6 sections)
    const stream = (s: ReturnType<typeof createSession>) =>
      Array.from({ length: N }, () => JSON.stringify(s.nextScore()));
    // deterministic + cached: two fresh stable sessions yield the same stream…
    expect(stream(createSession({ seed: 1, evolve: false }))).toEqual(
      stream(createSession({ seed: 1, evolve: false })),
    );
    // …and it is periodic from the loop point — an intro is played once, so it is the
    // CYCLE that repeats, not the stream from its very first score.
    const session = createSession({ seed: 1, evolve: false });
    const stable = stream(session);
    const first = stable[session.loopFrom]!;
    expect(stable.slice(session.loopFrom + 1).includes(first)).toBe(true);
    // evolving: same form, but melodies re-draw each pass → many distinct scores
    expect(new Set(stream(createSession({ seed: 1, evolve: true }))).size).toBeGreaterThan(8);
  });

  it("opens with a one-time introduction that the cycle never repeats", () => {
    const s = createSession({ seed: 4, style: "calm", evolve: false });
    expect(s.loopFrom).toBe(1);
    const intro = s.sections[0]!;
    expect(intro.part).toBe("intro");
    expect(intro.bars).toBeLessThan(s.bars); // shorter than a section of the form

    const opening = s.nextScore();
    const voices = opening.parts.map((p) => p.voice).sort();
    // It settles the key without stating the theme — holding that back is what makes
    // the theme's first statement sound like one.
    expect(voices).toEqual(["bass", "pad"]);
    expect(opening.drums).toEqual([]);
    expect(opening.bars).toBe(intro.bars);

    // Play well past the end of the form: the opening never comes round again.
    const later = Array.from({ length: 12 }, () => JSON.stringify(s.nextScore()));
    expect(later).not.toContain(JSON.stringify(opening));
  });

  it("can skip the introduction and start straight on the form", () => {
    const s = createSession({ seed: 4, style: "calm", intro: false });
    expect(s.loopFrom).toBe(0);
    expect(s.sections[0]!.part).not.toBe("intro");
    expect(s.nextScore().parts.some((p) => p.voice === "lead")).toBe(true);
  });

  it("validates bpm, beatsPerBar, and bars eagerly", () => {
    expect(() => createSession({ bpm: 0 })).toThrow(RangeError);
    expect(() => createSession({ beatsPerBar: 0 })).toThrow(RangeError);
    expect(() => createSession({ beatsPerBar: 1.5 })).toThrow(RangeError);
    expect(() => createSession({ bars: 3 })).toThrow(RangeError); // harmony needs >= 4
    expect(() => createSession({ bars: 7.5 })).toThrow(RangeError);
  });

  it("validates rootMidi/swing/density/raga eagerly — not lazily on the first nextScore", () => {
    // These used to surface only inside arrange() on the first tick; now createSession
    // (and thus createEngine) throws synchronously at construction.
    expect(() => createSession({ rootMidi: 200 })).toThrow(RangeError);
    expect(() => createSession({ rootMidi: 60.5 })).toThrow(RangeError);
    expect(() => createSession({ swing: 2 })).toThrow(RangeError);
    expect(() => createSession({ density: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    // raga must be a pitch-class subset of parent (hindolam's ♭6 isn't in major)
    expect(() => createSession({ parent: SCALES.major, raga: SCALES.hindolam })).toThrow(
      RangeError,
    );
  });

  it("exposes the form as sections (labels, key shifts, arp roles)", () => {
    const s = createSession({ seed: 13, style: "peppy" });
    expect(s.sections.length).toBeGreaterThanOrEqual(4); // a real multi-section form
    // A one-time opening leads the play order and sits outside the repeat.
    expect(s.loopFrom).toBe(1);
    expect(s.sections[0]!.part).toBe("intro");
    const cycle = s.sections.slice(s.loopFrom);
    // The cycle opens home: the theme stated plainly, in the home key.
    expect(cycle[0]).toEqual({
      label: "A",
      keyShift: 0,
      arpRole: "arp",
      development: { transform: "statement", step: 0 },
      part: "A",
      bars: 8,
      bpm: s.bpm,
    });
    for (const sec of cycle) {
      const role = sec.label === "A" ? "arp" : sec.label === "B" ? "harmony" : "double";
      expect(sec.arpRole).toBe(role); // arp orchestration tracks the section label
      const states = sec.development.transform === "statement";
      expect(states).toBe(sec.label === "A"); // only home restates the theme unchanged
    }
    for (const home of cycle.filter((x) => x.label === "A")) {
      expect(home.keyShift).toBe(0); // home sections never modulate
    }
  });

  it("a bridge section renders with no drums (instruments leave per section)", () => {
    let found: { bDrums: number; aDrums: number } | null = null;
    for (let seed = 1; seed < 40 && !found; seed++) {
      const sess = createSession({ seed, style: "peppy", humanize: false });
      const bIdx = sess.sections.findIndex((s) => s.label === "B");
      const aIdx = sess.sections.findIndex((s) => s.label === "A");
      if (bIdx >= 0) {
        const scores = Array.from({ length: sess.sections.length }, () => sess.nextScore());
        found = { bDrums: scores[bIdx]!.drums.length, aDrums: scores[aIdx]!.drums.length };
      }
    }
    expect(found).not.toBeNull();
    expect(found!.bDrums).toBe(0); // bridge dropped the drums
    expect(found!.aDrums).toBeGreaterThan(0); // home keeps them
  });

  it("humanize:false stays on the grid; true nudges timing but keeps the pitches", () => {
    const off = createSession({ seed: 1, humanize: false }).nextScore();
    const on = createSession({ seed: 1, humanize: true }).nextScore();
    const freqs = (s: typeof off) => s.parts.flatMap((p) => p.notes.map((n) => Math.round(n.freq)));
    const starts = (s: typeof off) => s.parts.flatMap((p) => p.notes.map((n) => n.startBeat));
    expect(freqs(on)).toEqual(freqs(off)); // same composition (humanize never retunes)
    expect(starts(on)).not.toEqual(starts(off)); // but the timing is nudged off-grid
  });

  it("applies per-section tempo — the bridge/climax differ from the home bpm", () => {
    const s = createSession({ seed: 13, style: "peppy", bpm: 120 });
    const bpms = Array.from({ length: s.sections.length }, () => s.nextScore().bpm);
    expect(new Set(bpms).size).toBeGreaterThan(1); // tempo changes across the form
    expect(bpms).toContain(120); // home sections play at the base tempo
  });

  it("draws instruments from the style's pools", () => {
    const s = createSession({ seed: 3, style: "calm" });
    expect(STYLES.calm.instruments.lead).toContain(s.instruments.lead.name); // from calm's pool
  });

  it("takes its meter from the chosen groove (waltz → 3/4, sixEight → 6/8)", () => {
    expect(createSession({ groove: "waltz" }).beatsPerBar).toBe(3);
    expect(createSession({ groove: "sixEight" }).beatsPerBar).toBe(6);
    expect(createSession({ groove: "straight" }).beatsPerBar).toBe(4);
    expect(createSession({ groove: "waltz", beatsPerBar: 4 }).beatsPerBar).toBe(4); // explicit wins
  });

  it("locks a 3/4 (waltz) and a 6/8 (sixEight) session (golden — non-4/4 determinism)", () => {
    const fingerprint = (groove: "waltz" | "sixEight") => {
      const s = createSession({ seed: 5, style: "calm", groove, humanize: false });
      const sc = s.nextScore();
      return {
        beatsPerBar: s.beatsPerBar,
        firstFreqs: sc.parts.flatMap((p) => p.notes.slice(0, 3).map((n) => Math.round(n.freq))),
        drums: sc.drums.slice(0, 6).map((d) => `${d.drum}@${d.startBeat}`),
      };
    };
    expect({ waltz: fingerprint("waltz"), sixEight: fingerprint("sixEight") }).toMatchSnapshot();
  });

  it("locks the seed→session mapping (golden — pins the style/instrument/arrange/noise fork chain)", () => {
    const s = createSession({ seed: 42, style: "peppy" });
    const score = s.nextScore();
    const round = (x: number) => Math.round(x * 1e6) / 1e6;
    const fingerprint = {
      instruments: instrumentNames(s),
      bpm: s.bpm,
      beatsPerBar: s.beatsPerBar,
      bars: s.bars,
      firstFreqs: score.parts.flatMap((p) => p.notes.slice(0, 4).map((n) => Math.round(n.freq))),
      noise: [s.noiseTable[0]!, s.noiseTable[100]!, s.noiseTable[1000]!].map(round),
    };
    expect(fingerprint).toMatchSnapshot();
  });
});
