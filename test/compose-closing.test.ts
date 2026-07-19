import { describe, expect, it } from "vitest";
import { CLOSING_BARS, closingScore } from "../src/compose/closing";
import { SCALES } from "../src/theory/scales";

const base = {
  parent: SCALES.major,
  raga: SCALES.mohanam,
  rootMidi: 60,
  bpm: 100,
  beatsPerBar: 4,
} as const;

const midiOf = (freq: number) => Math.round(69 + 12 * Math.log2(freq / 440));
const pc = (n: number) => ((n % 12) + 12) % 12;

describe("closingScore", () => {
  it("resolves home: every voice lands on the tonic chord", () => {
    for (const parent of [SCALES.major, SCALES.dorian, SCALES.naturalMinor]) {
      for (const rootMidi of [55, 60, 61, 64]) {
        const score = closingScore({ ...base, parent, rootMidi });
        const degrees = new Set(
          score.parts.flatMap((p) => p.notes.map((n) => pc(midiOf(n.freq) - rootMidi))),
        );
        // The tonic triad and nothing else — an ending that introduces a new tone
        // is not an ending.
        expect([...degrees].sort((a, b) => a - b)).toEqual([0, pc(parent[2]), pc(parent[4])]);
      }
    }
  });

  it("stacks the voices in their own registers, bass under pad under lead", () => {
    const score = closingScore(base);
    const at = (voice: string) => score.parts.find((p) => p.voice === voice)!.notes;
    const bassTop = Math.max(...at("bass").map((n) => n.freq));
    const padLow = Math.min(...at("pad").map((n) => n.freq));
    const padTop = Math.max(...at("pad").map((n) => n.freq));
    const lead = at("lead")[0]!.freq;
    expect(bassTop).toBeLessThan(padLow);
    expect(lead).toBeGreaterThanOrEqual(padTop);
  });

  it("is a single held chord — no drums, nothing struck twice", () => {
    const score = closingScore(base);
    expect(score.drums).toEqual([]); // a piece that stops pulsing has finished
    for (const part of score.parts) {
      for (const n of part.notes) {
        expect(n.startBeat).toBe(0); // they arrive together…
        expect(n.durationBeats).toBe(score.lengthBeats); // …and hold to the end
      }
    }
    expect(score.bars).toBe(CLOSING_BARS);
    expect(score.lengthBeats).toBe(CLOSING_BARS * base.beatsPerBar);
  });

  it("stays under the music it follows, so the ending swells rather than jolts", () => {
    // Three voices arriving together already sum louder than a playing bar; a final
    // chord at a normal part's velocity lands as a bump.
    const score = closingScore(base);
    for (const part of score.parts) {
      for (const n of part.notes) expect(n.velocity).toBeLessThan(0.5);
    }
  });

  it("carries the piece's tempo and meter, so the ending is in time with it", () => {
    const score = closingScore({ ...base, bpm: 84, beatsPerBar: 3 });
    expect(score.bpm).toBe(84);
    expect(score.beatsPerBar).toBe(3);
    expect(score.lengthBeats).toBe(CLOSING_BARS * 3);
  });
});
