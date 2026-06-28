/**
 * Progressions — a curated library plus a functional-harmony generator.
 *
 * Progressions are sequences of **0-based diatonic scale-degree roots** (so they
 * apply to any heptatonic key by position). The generator walks the classic
 * functional cycle Tonic → Subdominant → Dominant → Tonic.
 *
 * Note: functional *pull* (a strong dominant→tonic cadence) only fully
 * materialises on a parent with a leading tone (degree 6 a semitone below the
 * octave) and a consonant tonic triad — i.e. major-like parents. On modal
 * parents (dorian, natural minor, …) the same motion is valid but gentler
 * (minor v→i); `locrian` has no stable tonic and is best avoided as a parent.
 */
import type { Rng } from "../rng";

/** Named progressions as 0-based scale-degree roots. */
export const PROGRESSIONS = {
  axis: [0, 4, 5, 3], // I–V–vi–IV
  pop: [0, 5, 3, 4], // I–vi–IV–V
  classic: [0, 3, 4, 0], // I–IV–V–I
  emotional: [5, 3, 0, 4], // vi–IV–I–V
  doowop: [0, 5, 1, 4], // I–vi–ii–V
  ascending: [0, 3, 4, 5], // I–IV–V–vi
  pachelbel: [0, 4, 5, 2, 3, 0, 3, 4], // I–V–vi–iii–IV–I–IV–V
} as const satisfies Record<string, readonly number[]>;

/** Name of a built-in progression. */
export type ProgressionName = keyof typeof PROGRESSIONS;

/** Harmonic function of a chord. */
export type HarmonicFunction = "T" | "S" | "D";

/** Function of each diatonic degree (by major-mode position). */
export const FUNCTION_OF: Readonly<Record<number, HarmonicFunction>> = {
  0: "T", // I
  1: "S", // ii
  2: "T", // iii (tonic substitute)
  3: "S", // IV
  4: "D", // V
  5: "T", // vi
  6: "D", // vii°
};

interface Weighted<T> {
  readonly choices: readonly T[];
  readonly weights: readonly number[];
}

/** Legal function-to-function moves, with weights. */
const TRANSITIONS: Record<HarmonicFunction, Weighted<HarmonicFunction>> = {
  T: { choices: ["S", "D"], weights: [0.55, 0.45] },
  S: { choices: ["D", "T", "S"], weights: [0.65, 0.15, 0.2] },
  D: { choices: ["T", "D"], weights: [0.75, 0.25] },
};

/** Candidate degrees within each function, primary-weighted. */
const DEGREES_IN: Record<HarmonicFunction, Weighted<number>> = {
  T: { choices: [0, 5, 2], weights: [6, 3, 1] },
  S: { choices: [3, 1], weights: [6, 4] },
  D: { choices: [4, 6], weights: [6, 2] },
};

function nextFunction(rng: Rng, from: HarmonicFunction): HarmonicFunction {
  const move = TRANSITIONS[from];
  return rng.weighted(move.choices, move.weights);
}

function degreeFor(rng: Rng, fn: HarmonicFunction): number {
  const degree = DEGREES_IN[fn];
  return rng.weighted(degree.choices, degree.weights);
}

/**
 * Generate a functional progression of exactly `length` degree roots, starting
 * on the tonic. Mode-blind (returns degree positions); deterministic for a seed.
 */
export function functionalProgression(rng: Rng, length: number): number[] {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError(`functionalProgression length must be an integer >= 1, got ${length}`);
  }
  const degrees: number[] = [0]; // open on the tonic
  let fn: HarmonicFunction = "T";
  for (let i = 1; i < length; i++) {
    fn = nextFunction(rng, fn);
    degrees.push(degreeFor(rng, fn));
  }
  return degrees;
}
