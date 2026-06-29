import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arrange } from "../src/compose/arranger";
import { humanize } from "../src/compose/humanize";
import { makeRng } from "../src/rng";

const base = (seed = 1) => arrange({ rng: makeRng(seed), bars: 8, beatsPerBar: 4 });

describe("humanize", () => {
  it("is deterministic for a given rng seed", () => {
    expect(humanize(base(), makeRng(5))).toEqual(humanize(base(), makeRng(5)));
  });

  it("leaves pitch and note count untouched", () => {
    const score = base();
    const h = humanize(score, makeRng(3));
    expect(h.parts.map((p) => p.notes.map((n) => n.freq))).toEqual(
      score.parts.map((p) => p.notes.map((n) => n.freq)),
    );
    expect(h.drums.length).toBe(score.drums.length);
  });

  it("keeps every note in-bounds and well-formed, for any seed", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (arrSeed, humSeed) => {
        const h = humanize(base(arrSeed), makeRng(humSeed));
        for (const part of h.parts) {
          for (const n of part.notes) {
            expect(n.startBeat).toBeGreaterThanOrEqual(0);
            expect(n.startBeat).toBeLessThan(h.lengthBeats);
            expect(n.startBeat + n.durationBeats).toBeLessThanOrEqual(h.lengthBeats + 1e-6);
            expect(n.durationBeats).toBeGreaterThan(0);
            expect(n.velocity).toBeGreaterThan(0);
            expect(n.velocity).toBeLessThanOrEqual(1);
          }
        }
        for (const d of h.drums) {
          expect(d.startBeat).toBeGreaterThanOrEqual(0);
          expect(d.startBeat).toBeLessThan(h.lengthBeats);
          expect(d.velocity).toBeGreaterThan(0);
          expect(d.velocity).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("nudges timing within the configured bound (and actually moves notes)", () => {
    const score = base();
    const h = humanize(score, makeRng(9), { timing: 0.02, velocity: 0.06 });
    let changed = false;
    score.parts.forEach((part, pi) => {
      part.notes.forEach((n, ni) => {
        const hn = h.parts[pi]!.notes[ni]!;
        expect(Math.abs(hn.startBeat - n.startBeat)).toBeLessThanOrEqual(0.02 + 1e-9);
        if (hn.startBeat !== n.startBeat || hn.velocity !== n.velocity) changed = true;
      });
    });
    expect(changed).toBe(true);
  });

  it("locks the humanized output for a fixed seed (golden — pins rng draw order)", () => {
    const h = humanize(base(7), makeRng(7));
    const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
    const compact = h.parts.map((p) => ({
      voice: p.voice,
      notes: p.notes.slice(0, 6).map((n) => [r4(n.startBeat), r4(n.velocity)]),
    }));
    expect(compact).toMatchSnapshot();
  });
});
