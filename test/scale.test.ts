import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROOT_MIDI,
  SCALES,
  degreeToFrequency,
  degreeToSemitone,
  semitoneToFrequency,
  type Scale,
} from "../src/scale";

describe("SCALES", () => {
  it("ships major pentatonic and major with the right intervals", () => {
    expect(SCALES.majorPentatonic).toEqual([0, 2, 4, 7, 9]);
    expect(SCALES.major).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it.each(Object.entries(SCALES))(
    "%s is ascending, starts at 0, stays within an octave",
    (_, scale) => {
      expect(scale[0]).toBe(0);
      for (let i = 1; i < scale.length; i++) {
        expect(scale[i]!).toBeGreaterThan(scale[i - 1]!);
      }
      expect(scale[scale.length - 1]!).toBeLessThan(12);
    },
  );
});

describe("degreeToSemitone", () => {
  const penta = SCALES.majorPentatonic;

  it("maps the tonic (degree 0) to 0", () => {
    expect(degreeToSemitone(penta, 0)).toBe(0);
  });

  it("maps in-octave degrees to their offsets", () => {
    expect([0, 1, 2, 3, 4].map((d) => degreeToSemitone(penta, d))).toEqual([0, 2, 4, 7, 9]);
  });

  it("wraps upward, adding an octave per wrap", () => {
    expect(degreeToSemitone(penta, 5)).toBe(12); // tonic, +1 octave
    expect(degreeToSemitone(penta, 6)).toBe(14); // 2nd degree, +1 octave
    expect(degreeToSemitone(penta, 10)).toBe(24); // tonic, +2 octaves
  });

  it("wraps downward for negative degrees", () => {
    expect(degreeToSemitone(penta, -1)).toBe(-3); // 6th below the tonic (A below C)
    expect(degreeToSemitone(penta, -5)).toBe(-12); // tonic, one octave down
    expect(degreeToSemitone(penta, -6)).toBe(-15);
  });

  it("works for the seven-note major scale too", () => {
    expect(degreeToSemitone(SCALES.major, 7)).toBe(12);
    expect(degreeToSemitone(SCALES.major, -1)).toBe(-1); // leading tone below the tonic
  });

  it("throws on a non-integer degree or an empty scale", () => {
    expect(() => degreeToSemitone(penta, 1.5)).toThrow(RangeError);
    expect(() => degreeToSemitone(penta, Number.NaN)).toThrow(RangeError);
    expect(() => degreeToSemitone([] as Scale, 0)).toThrow(RangeError);
  });

  it("only ever yields pitch classes that belong to the scale (any degree)", () => {
    const pitchClasses = new Set(penta.map((s) => s % 12));
    for (let degree = -50; degree <= 50; degree++) {
      const semitone = degreeToSemitone(penta, degree);
      expect(pitchClasses.has(((semitone % 12) + 12) % 12)).toBe(true);
    }
  });
});

describe("semitoneToFrequency", () => {
  it("A4 (MIDI 69) is exactly 440 Hz", () => {
    expect(semitoneToFrequency(9, 60)).toBe(440); // 60 + 9 = 69
  });

  it("middle C (MIDI 60) is ~261.63 Hz", () => {
    expect(semitoneToFrequency(0, 60)).toBeCloseTo(261.6256, 3);
  });

  it("an octave up doubles the frequency", () => {
    const c4 = semitoneToFrequency(0, 60);
    const c5 = semitoneToFrequency(12, 60);
    expect(c5 / c4).toBeCloseTo(2, 10);
  });

  it("defaults the root to middle C", () => {
    expect(semitoneToFrequency(0)).toBe(semitoneToFrequency(0, DEFAULT_ROOT_MIDI));
    expect(DEFAULT_ROOT_MIDI).toBe(60);
  });

  it("uses rootMidi for the absolute pitch, not just the offset", () => {
    // Guards against a regression that hardcodes 60 in place of rootMidi: that
    // bug is invisible at root 60 but wrong everywhere else.
    expect(semitoneToFrequency(0, 69)).toBe(440); // tonic at A4
    expect(semitoneToFrequency(0, 67)).toBeCloseTo(440 * 2 ** ((67 - 69) / 12), 9); // tonic at G4
  });

  it("equals the canonical equal-temperament formula for arbitrary notes", () => {
    for (const midi of [21, 40, 60, 69, 88, 108]) {
      const expected = 440 * 2 ** ((midi - 69) / 12);
      expect(semitoneToFrequency(midi - 60, 60)).toBeCloseTo(expected, 9);
    }
  });
});

describe("degreeToFrequency", () => {
  it("composes degree → semitone → frequency", () => {
    const penta = SCALES.majorPentatonic;
    expect(degreeToFrequency(penta, 0, 60)).toBeCloseTo(semitoneToFrequency(0, 60), 10);
    expect(degreeToFrequency(penta, 3, 60)).toBeCloseTo(semitoneToFrequency(7, 60), 10);
  });

  it("a degree one octave up doubles the frequency", () => {
    const penta = SCALES.majorPentatonic;
    const tonic = degreeToFrequency(penta, 0, 67);
    const tonicUp = degreeToFrequency(penta, penta.length, 67);
    expect(tonicUp / tonic).toBeCloseTo(2, 10);
  });

  it("defaults the root to middle C", () => {
    const penta = SCALES.majorPentatonic;
    expect(degreeToFrequency(penta, 2)).toBe(degreeToFrequency(penta, 2, DEFAULT_ROOT_MIDI));
  });
});
