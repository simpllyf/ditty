import { describe, expect, it } from "vitest";
import {
  RAGA_PATHS,
  type RagaPaths,
  SCALES,
  type Scale,
  degreePitchClass,
  degreeToFrequency,
  degreeToSemitone,
} from "../src/theory/scales";
import { semitoneToFrequency } from "../src/theory/pitch";

describe("SCALES library", () => {
  it("is broad (20+ scales)", () => {
    expect(Object.keys(SCALES).length).toBeGreaterThanOrEqual(20);
  });

  it.each(Object.entries(SCALES))(
    "%s is integer, ascending, 0-based, within an octave",
    (_, scale) => {
      expect(scale[0]).toBe(0);
      expect(scale[scale.length - 1]!).toBeLessThan(12);
      for (const interval of scale) {
        expect(Number.isInteger(interval)).toBe(true);
      }
      for (let i = 1; i < scale.length; i++) {
        expect(scale[i]!).toBeGreaterThan(scale[i - 1]!);
      }
    },
  );

  it("keeps the documented raga↔mode aliases equal (so they can't drift)", () => {
    expect(SCALES.mohanam).toEqual(SCALES.majorPentatonic);
    expect(SCALES.kalyani).toEqual(SCALES.lydian);
    expect(SCALES.shankarabharanam).toEqual(SCALES.major);
    expect(SCALES.kharaharapriya).toEqual(SCALES.dorian);
  });
});

describe("degreeToSemitone", () => {
  const penta = SCALES.majorPentatonic; // [0,2,4,7,9]

  it("maps the tonic and in-octave degrees", () => {
    expect([0, 1, 2, 3, 4].map((d) => degreeToSemitone(penta, d))).toEqual([0, 2, 4, 7, 9]);
  });

  it("wraps up and down by an octave per scale length", () => {
    expect(degreeToSemitone(penta, 5)).toBe(12);
    expect(degreeToSemitone(penta, -1)).toBe(-3);
    expect(degreeToSemitone(penta, -5)).toBe(-12);
  });

  it("throws on a non-integer degree or empty scale", () => {
    expect(() => degreeToSemitone(penta, 1.5)).toThrow(RangeError);
    expect(() => degreeToSemitone([] as Scale, 0)).toThrow(RangeError);
  });
});

describe("RAGA_PATHS — arohana / avarohana", () => {
  const entries = Object.entries(RAGA_PATHS) as [keyof typeof RAGA_PATHS, RagaPaths][];

  it.each(entries)("%s: each path is itself a well-formed scale containing the tonic", (_, p) => {
    for (const path of [p.up, p.down]) {
      expect(path[0]).toBe(0); // a raga starts from the tonic in both directions
      expect(path[path.length - 1]!).toBeLessThan(12);
      for (let i = 1; i < path.length; i++) expect(path[i]!).toBeGreaterThan(path[i - 1]!);
    }
  });

  it.each(entries)("%s: ascent ∪ descent is exactly its SCALES entry", (name, p) => {
    // The union is the degree space the melody moves in; the paths only say which of
    // its notes each direction may use. Drift here would put the lead out of its scale.
    const union = [...new Set([...p.up, ...p.down])].sort((a, b) => a - b);
    expect(union).toEqual([...SCALES[name]]);
  });

  it.each(entries)("%s: actually moves differently up and down", (_, p) => {
    // A raga whose paths match belongs in SCALES alone — the registry is for the
    // ones whose identity IS the asymmetry.
    expect([...p.up]).not.toEqual([...p.down]);
  });
});

describe("degreePitchClass", () => {
  it("stays in 0..11 and is octave-invariant", () => {
    const major = SCALES.major;
    for (let d = -14; d <= 14; d++) {
      const pc = degreePitchClass(major, d);
      expect(pc).toBeGreaterThanOrEqual(0);
      expect(pc).toBeLessThan(12);
      expect(degreePitchClass(major, d + major.length)).toBe(pc);
    }
  });
});

describe("degreeToFrequency", () => {
  it("composes degree → semitone → frequency, default root middle C", () => {
    const penta = SCALES.majorPentatonic;
    expect(degreeToFrequency(penta, 3, 60)).toBeCloseTo(semitoneToFrequency(7, 60), 10);
    expect(degreeToFrequency(penta, 2)).toBe(degreeToFrequency(penta, 2, 60));
  });
});
