/**
 * Chords — qualities, diatonic chord building, and chord-tone queries. Pure,
 * pitch-class based (octave-agnostic). The harmony layer builds on this.
 */
import { pitchClass } from "./pitch";
import { type Scale, degreePitchClass } from "./scales";

/** Chord qualities as semitone intervals from the root. */
export const CHORD_QUALITIES = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  dominant7: [0, 4, 7, 10],
  diminished7: [0, 3, 6, 9],
  halfDiminished7: [0, 3, 6, 10],
} as const satisfies Record<string, readonly number[]>;

/** Name of a chord quality. */
export type ChordQuality = keyof typeof CHORD_QUALITIES;

/** A chord as a root pitch class plus its (deduped) member pitch classes. */
export interface Chord {
  /** Root pitch class, 0–11. */
  readonly root: number;
  /** Member pitch classes, 0–11, root first, no duplicates. */
  readonly pcs: readonly number[];
}

function dedupe(values: readonly number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** Pitch classes of a chord built from a root pitch class and a quality. */
export function chordPitchClasses(rootPc: number, quality: ChordQuality): number[] {
  return CHORD_QUALITIES[quality].map((interval) => pitchClass(rootPc + interval));
}

/** Build a {@link Chord} from a root pitch class and a quality. */
export function makeChord(rootPc: number, quality: ChordQuality): Chord {
  return { root: pitchClass(rootPc), pcs: dedupe(chordPitchClasses(rootPc, quality)) };
}

/**
 * Diatonic chord built by stacking scale thirds from `degree` (degree, +2, +4,
 * and +6 for a seventh). Pitch-class based; duplicates are removed (e.g. a
 * seventh on a six-note scale folds back to the root). Routed through the
 * wrap-safe degree helpers so any scale length and any integer degree are valid.
 */
export function diatonicChord(scale: Scale, degree: number, size: 3 | 4 = 3): Chord {
  const offsets = size === 4 ? [0, 2, 4, 6] : [0, 2, 4];
  const pcs = dedupe(offsets.map((o) => degreePitchClass(scale, degree + o)));
  return { root: pcs[0] as number, pcs };
}

/** Whether a pitch class is a member of a chord. */
export function isChordTone(pc: number, chord: Chord): boolean {
  return chord.pcs.includes(pitchClass(pc));
}

/** Identify a chord's quality by its interval signature, or null if unknown. */
export function chordQualityOf(chord: Chord): ChordQuality | null {
  const intervals = chord.pcs.map((p) => pitchClass(p - chord.root)).sort((a, b) => a - b);
  for (const name of Object.keys(CHORD_QUALITIES) as ChordQuality[]) {
    const q = [...CHORD_QUALITIES[name]].map(pitchClass).sort((a, b) => a - b);
    if (q.length === intervals.length && q.every((v, i) => v === intervals[i])) {
      return name;
    }
  }
  return null;
}

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];

/**
 * Roman-numeral labels for the diatonic triads of a seven-note scale
 * (uppercase = major, lowercase = minor, `°` = diminished, `+` = augmented).
 */
export function romanNumerals(scale: Scale): string[] {
  if (scale.length !== 7) {
    throw new RangeError(`romanNumerals() requires a 7-note scale, got length ${scale.length}`);
  }
  return scale.map((_, degree) => {
    const quality = chordQualityOf(diatonicChord(scale, degree, 3));
    const base = NUMERALS[degree] as string;
    if (quality === "minor") return base.toLowerCase();
    if (quality === "diminished") return `${base.toLowerCase()}°`;
    if (quality === "augmented") return `${base}+`;
    if (quality === null) return `${base}?`; // non-tertian triad (exotic scale) — don't imply major
    return base;
  });
}
