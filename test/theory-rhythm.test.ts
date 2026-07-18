import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DRUM_GROOVES,
  SWING_MAX,
  applySwing,
  fitGroove,
  melodyRhythm,
  metricStrength,
} from "../src/theory/rhythm";
import { makeRng } from "../src/rng";

describe("metricStrength", () => {
  it("ranks downbeat > even-meter midpoint > on-beat > offbeat > finer", () => {
    expect(metricStrength(0, 4)).toBe(1);
    expect(metricStrength(2, 4)).toBe(0.8); // 4/4 midpoint
    expect(metricStrength(1, 4)).toBe(0.5);
    expect(metricStrength(0.5, 4)).toBe(0.3);
    expect(metricStrength(1.5, 4)).toBe(0.3); // offbeat away from beat 0 too
    expect(metricStrength(0.25, 4)).toBe(0.15);
  });

  it("places the even-meter midpoint accent by beatsPerBar/2, not a hardcoded beat", () => {
    expect(metricStrength(3, 6)).toBe(0.8); // 6/4 midpoint is beat 3
    expect(metricStrength(2, 6)).toBe(0.5); // beat 2 is just an on-beat
  });

  it("is meter-aware: 3/4 is strong-weak-weak (no midpoint accent)", () => {
    expect(metricStrength(0, 3)).toBe(1);
    expect(metricStrength(1, 3)).toBe(0.5); // not a midpoint → not strong
    expect(metricStrength(2, 3)).toBe(0.5);
  });
});

describe("melodyRhythm", () => {
  it("stays ordered and inside the bar, downbeat always sounding (any seed/meter)", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: 3, max: 6 }),
        fc.boolean(),
        (seed, beatsPerBar, phraseEnd) => {
          const onsets = melodyRhythm(makeRng(seed), beatsPerBar, { phraseEnd });
          // The bar is anchored: the downbeat always sounds, on a strong position.
          expect(onsets[0]!.startBeat).toBe(0);
          expect(onsets[0]!.strong).toBe(true);
          for (const o of onsets) {
            expect(o.durationBeats).toBeGreaterThan(0);
            expect(o.strong).toBe(metricStrength(o.startBeat, beatsPerBar) >= 0.8);
          }
          // Onsets no longer tile the bar (gaps ARE the rests), but they must stay
          // ordered, never overlap, and never spill past the bar line.
          for (let i = 1; i < onsets.length; i++) {
            const prevEnd = onsets[i - 1]!.startBeat + onsets[i - 1]!.durationBeats;
            expect(onsets[i]!.startBeat).toBeGreaterThanOrEqual(prevEnd - 1e-9);
          }
          const last = onsets[onsets.length - 1]!;
          expect(last.startBeat + last.durationBeats).toBeLessThanOrEqual(beatsPerBar + 1e-9);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("breathes: leaves real rests and sustains notes across beats", () => {
    let rests = 0;
    let sustained = 0;
    for (let seed = 0; seed < 200; seed++) {
      const onsets = melodyRhythm(makeRng(seed), 4);
      for (let i = 1; i < onsets.length; i++) {
        const gap =
          onsets[i]!.startBeat - (onsets[i - 1]!.startBeat + onsets[i - 1]!.durationBeats);
        if (gap > 1e-9) rests++;
      }
      const last = onsets[onsets.length - 1]!;
      if (last.startBeat + last.durationBeats < 4 - 1e-9) rests++; // trailing breath
      sustained += onsets.filter((o) => o.durationBeats > 1).length;
    }
    expect(rests).toBeGreaterThan(0); // a line that never rests reads as machine-made
    expect(sustained).toBeGreaterThan(0); // ...and one that never holds cannot sing
  });

  it("a phrase-ending bar lands, holds, then breathes out", () => {
    for (let seed = 0; seed < 60; seed++) {
      const onsets = melodyRhythm(makeRng(seed), 4, { phraseEnd: true });
      const last = onsets[onsets.length - 1]!;
      // It always leaves silence before the bar line — that is the breath.
      expect(last.startBeat + last.durationBeats).toBeLessThan(4);
      // ...and the note it leaves ringing is held beyond a single beat.
      expect(last.durationBeats).toBeGreaterThan(1);
    }
  });

  it("is deterministic for a seed", () => {
    expect(melodyRhythm(makeRng(7), 4)).toEqual(melodyRhythm(makeRng(7), 4));
  });

  it("density biases note count (sparse < dense, on average)", () => {
    const avg = (density: number) => {
      let total = 0;
      const runs = 400;
      for (let seed = 0; seed < runs; seed++) {
        total += melodyRhythm(makeRng(seed), 4, { density }).length;
      }
      return total / runs;
    };
    expect(avg(0.1)).toBeLessThan(avg(0.9));
  });

  it("rejects a bad beatsPerBar", () => {
    expect(() => melodyRhythm(makeRng(1), 0)).toThrow(RangeError);
    expect(() => melodyRhythm(makeRng(1), 2.5)).toThrow(RangeError);
  });
});

describe("DRUM_GROOVES & fitGroove", () => {
  it.each(Object.entries(DRUM_GROOVES))(
    "%s has grid-aligned hits within its own meter",
    (_, groove) => {
      for (const lane of [groove.kick, groove.snare, groove.hat]) {
        for (const pos of lane) {
          expect(pos).toBeGreaterThanOrEqual(0);
          expect(pos).toBeLessThan(groove.beatsPerBar); // hits stay inside the groove's bar
          expect((pos * 4) % 1).toBe(0); // multiple of a sixteenth
        }
      }
    },
  );

  it("waltz is 3/4 and sixEight is 6/8", () => {
    expect(DRUM_GROOVES.waltz.beatsPerBar).toBe(3);
    expect(DRUM_GROOVES.sixEight.beatsPerBar).toBe(6);
    expect(DRUM_GROOVES.straight.beatsPerBar).toBe(4); // unchanged grooves stay 4/4
  });

  it("'none' is a silent 4/4 groove", () => {
    expect(DRUM_GROOVES.none).toEqual({ beatsPerBar: 4, kick: [], snare: [], hat: [] });
  });

  it("fitGroove keeps a subset and drops hits at/after the meter", () => {
    const fit = fitGroove(DRUM_GROOVES.straight, 3);
    expect(fit.beatsPerBar).toBe(3); // re-tagged to the clipped meter
    for (const lane of [fit.kick, fit.snare, fit.hat]) {
      for (const pos of lane) expect(pos).toBeLessThan(3);
    }
    expect(fit.snare).not.toContain(3); // the beat-3 backbeat is dropped in 3/4
    // wider meter keeps every 4/4 hit (max position 3.5 < 6); only the meter tag changes
    expect(fitGroove(DRUM_GROOVES.straight, 6)).toEqual({
      ...DRUM_GROOVES.straight,
      beatsPerBar: 6,
    });
  });
});

describe("applySwing", () => {
  it("is identity at amount 0 and leaves on-beats / sixteenths untouched", () => {
    expect(applySwing(0.5, 0)).toBe(0.5);
    expect(applySwing(1, 0.5)).toBe(1); // on-beat
    expect(applySwing(0.25, 0.5)).toBe(0.25); // sixteenth, not an offbeat eighth
    expect(applySwing(0.75, 0.5)).toBe(0.75);
  });

  it("delays every offbeat eighth, monotonic in amount and never crossing x.75", () => {
    expect(applySwing(0.5, 1)).toBeCloseTo(0.5 + SWING_MAX, 10);
    expect(applySwing(1.5, 1)).toBeCloseTo(1.5 + SWING_MAX, 10); // not just beat-0's offbeat
    expect(applySwing(2, 1)).toBe(2); // higher on-beat untouched
    expect(applySwing(0.5, 1)).toBeLessThan(0.75);
    expect(applySwing(0.5, 0.8)).toBeGreaterThan(applySwing(0.5, 0.4));
    expect(SWING_MAX).toBeLessThan(0.25);
  });

  it("clamps the amount so out-of-range input can't reorder onsets", () => {
    expect(applySwing(0.5, 2)).toBe(applySwing(0.5, 1)); // capped at SWING_MAX
    expect(applySwing(0.5, -1)).toBe(0.5); // negative → identity
  });
});
