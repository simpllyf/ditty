import { describe, expect, it } from "vitest";
import type { ScoreVoice } from "../src/compose/arranger";
import { createSession } from "../src/session";

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

  it("evolve:false caches one score; evolve:true advances", () => {
    const stable = createSession({ seed: 1, evolve: false });
    expect(stable.nextScore()).toBe(stable.nextScore()); // same cached object
    const evolving = createSession({ seed: 1, evolve: true });
    expect(evolving.nextScore()).not.toEqual(evolving.nextScore());
  });

  it("validates bpm", () => {
    expect(() => createSession({ bpm: 0 })).toThrow(RangeError);
  });

  it("draws instruments from the style's pools", () => {
    const s = createSession({ seed: 3, style: "calm" });
    expect(["sineLead", "marimba"]).toContain(s.instruments.lead.name); // calm's lead pool
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
