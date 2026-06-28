import { describe, expect, it } from "vitest";
import {
  CHORD_QUALITIES,
  chordPitchClasses,
  chordQualityOf,
  diatonicChord,
  isChordTone,
  makeChord,
  romanNumerals,
} from "../src/theory/chords";
import { SCALES } from "../src/theory/scales";

describe("chord qualities", () => {
  it("defines the expected interval signatures", () => {
    expect(CHORD_QUALITIES.major).toEqual([0, 4, 7]);
    expect(CHORD_QUALITIES.minor).toEqual([0, 3, 7]);
    expect(CHORD_QUALITIES.diminished).toEqual([0, 3, 6]);
    expect(CHORD_QUALITIES.dominant7).toEqual([0, 4, 7, 10]);
  });

  it("chordPitchClasses builds from a root and wraps mod 12", () => {
    expect(chordPitchClasses(0, "major")).toEqual([0, 4, 7]);
    expect(chordPitchClasses(10, "major")).toEqual([10, 2, 5]); // Bb major: Bb D F
    expect(chordPitchClasses(7, "minor")).toEqual([7, 10, 2]); // G minor
  });

  it("spells every quality from C (independent literal check, catches table typos)", () => {
    expect(chordPitchClasses(0, "augmented")).toEqual([0, 4, 8]);
    expect(chordPitchClasses(0, "sus2")).toEqual([0, 2, 7]);
    expect(chordPitchClasses(0, "sus4")).toEqual([0, 5, 7]);
    expect(chordPitchClasses(0, "major7")).toEqual([0, 4, 7, 11]);
    expect(chordPitchClasses(0, "minor7")).toEqual([0, 3, 7, 10]);
    expect(chordPitchClasses(0, "diminished7")).toEqual([0, 3, 6, 9]);
    expect(chordPitchClasses(0, "halfDiminished7")).toEqual([0, 3, 6, 10]);
  });

  it("makeChord normalizes the root and dedupes", () => {
    expect(makeChord(12, "major")).toEqual({ root: 0, pcs: [0, 4, 7] });
  });
});

describe("diatonicChord", () => {
  const major = SCALES.major;

  it("stacks scale thirds into triads", () => {
    expect(diatonicChord(major, 0).pcs).toEqual([0, 4, 7]); // I
    expect(diatonicChord(major, 1).pcs).toEqual([2, 5, 9]); // ii
    expect(diatonicChord(major, 4).pcs).toEqual([7, 11, 2]); // V
  });

  it("builds sevenths with size 4", () => {
    expect(diatonicChord(major, 0, 4).pcs).toEqual([0, 4, 7, 11]); // Imaj7
  });

  it("works on a minor scale (i = minor triad)", () => {
    expect(diatonicChord(SCALES.naturalMinor, 0).pcs).toEqual([0, 3, 7]);
  });

  it("dedupes the seventh-folds-to-root collapse on hexatonic scales (exact values)", () => {
    expect(diatonicChord(SCALES.blues, 0, 4).pcs).toEqual([0, 5, 7]); // 4 stacked → 3 after dedupe
    expect(diatonicChord(SCALES.wholeTone, 0, 4).pcs).toEqual([0, 4, 8]);
  });

  it("never produces an undefined member (any scale, any degree)", () => {
    for (const scale of Object.values(SCALES)) {
      for (let d = -10; d <= 10; d++) {
        for (const member of diatonicChord(scale, d, 4).pcs) {
          expect(Number.isInteger(member)).toBe(true);
          expect(member).toBeGreaterThanOrEqual(0);
          expect(member).toBeLessThan(12);
        }
      }
    }
  });
});

describe("isChordTone", () => {
  it("matches members (octave-agnostic) and rejects non-members", () => {
    const c = makeChord(0, "major"); // C E G
    expect(isChordTone(4, c)).toBe(true);
    expect(isChordTone(16, c)).toBe(true); // 16 ≡ 4
    expect(isChordTone(2, c)).toBe(false);
  });
});

describe("chordQualityOf & romanNumerals", () => {
  it("identifies triad qualities", () => {
    expect(chordQualityOf(makeChord(0, "minor"))).toBe("minor");
    expect(chordQualityOf(diatonicChord(SCALES.major, 1))).toBe("minor"); // ii
    expect(chordQualityOf(diatonicChord(SCALES.major, 6))).toBe("diminished"); // vii°
  });

  it("round-trips every quality, incl. sevenths (locks the length guard)", () => {
    for (const quality of [
      "major7",
      "minor7",
      "dominant7",
      "diminished7",
      "halfDiminished7",
    ] as const) {
      expect(chordQualityOf(makeChord(0, quality))).toBe(quality);
    }
  });

  it("returns null for a non-tertian chord", () => {
    // major pentatonic degree 0 stacks to [0,4,9] — not a known quality.
    expect(chordQualityOf(diatonicChord(SCALES.majorPentatonic, 0))).toBeNull();
  });

  it("labels diatonic triads for major, natural minor, and harmonic minor", () => {
    expect(romanNumerals(SCALES.major)).toEqual(["I", "ii", "iii", "IV", "V", "vi", "vii°"]);
    expect(romanNumerals(SCALES.naturalMinor)).toEqual(["i", "ii°", "III", "iv", "v", "VI", "VII"]);
    expect(romanNumerals(SCALES.harmonicMinor)).toEqual([
      "i",
      "ii°",
      "III+",
      "iv",
      "V",
      "VI",
      "vii°",
    ]);
  });

  it("marks non-tertian triads with '?' rather than implying major (exotic ragas)", () => {
    const labels = romanNumerals(SCALES.mayamalavagowla);
    expect(labels).toHaveLength(7);
    expect(labels.some((l) => l.includes("?"))).toBe(true); // degrees 5 & 7 are non-tertian
  });

  it("throws on a non-heptatonic scale", () => {
    expect(() => romanNumerals(SCALES.majorPentatonic)).toThrow(RangeError);
  });
});
