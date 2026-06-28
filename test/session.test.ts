import { describe, expect, it } from "vitest";
import type { ScoreVoice } from "../src/compose/arranger";
import { createSession } from "../src/session";
import { STYLES } from "../src/styles";

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
    // …and it is periodic — the whole form repeats (a later score equals the first)
    const stable = stream(createSession({ seed: 1, evolve: false }));
    expect(stable.slice(1).includes(stable[0]!)).toBe(true);
    // evolving: same form, but melodies re-draw each pass → many distinct scores
    expect(new Set(stream(createSession({ seed: 1, evolve: true }))).size).toBeGreaterThan(8);
  });

  it("validates bpm, beatsPerBar, and bars eagerly", () => {
    expect(() => createSession({ bpm: 0 })).toThrow(RangeError);
    expect(() => createSession({ beatsPerBar: 0 })).toThrow(RangeError);
    expect(() => createSession({ beatsPerBar: 1.5 })).toThrow(RangeError);
    expect(() => createSession({ bars: 3 })).toThrow(RangeError); // harmony needs >= 4
    expect(() => createSession({ bars: 7.5 })).toThrow(RangeError);
  });

  it("exposes the form as sections (labels, key shifts, arp roles)", () => {
    const s = createSession({ seed: 13, style: "peppy" });
    expect(s.sections.length).toBeGreaterThanOrEqual(4); // a real multi-section form
    expect(s.sections[0]).toEqual({ label: "A", keyShift: 0, arpRole: "arp" }); // opens home
    for (const sec of s.sections) {
      const role = sec.label === "A" ? "arp" : sec.label === "B" ? "harmony" : "double";
      expect(sec.arpRole).toBe(role); // arp orchestration tracks the section label
    }
    for (const home of s.sections.filter((x) => x.label === "A")) {
      expect(home.keyShift).toBe(0); // home sections never modulate
    }
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
