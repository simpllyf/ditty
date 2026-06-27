/**
 * Musicality — the pure constraints that turn a raw random walk into something
 * intentional. This is where "pleasant by constraint, not cleverness" lives: a
 * leap cap for mostly-stepwise motion, phrase resolution onto stable tones, a
 * gentle contour bias, and anti-repeat guards so motifs recur without staling.
 *
 * Everything here operates on integer **scale degrees** (indices into a
 * {@link Scale}); the melody layer composes these helpers.
 */
import type { Rng } from "./rng";
import { type Scale, degreeToSemitone } from "./scale";

/** Default maximum jump between consecutive notes, in scale degrees. */
export const DEFAULT_MAX_LEAP = 4;
/** Default cap on how many times one note may sound in a row. */
export const DEFAULT_MAX_NOTE_REPEAT = 2;
/** Stable resolution targets, as pitch classes: the major triad (1, 3, 5). */
export const STABLE_PITCH_CLASSES: readonly number[] = [0, 4, 7];

// --- Leap cap -------------------------------------------------------------

/** Whether a candidate is within `maxLeap` scale degrees of the previous note. */
export function isWithinLeap(
  prevDegree: number,
  candidateDegree: number,
  maxLeap: number = DEFAULT_MAX_LEAP,
): boolean {
  return Math.abs(candidateDegree - prevDegree) <= maxLeap;
}

/** Clamp a candidate so it sits within `maxLeap` scale degrees of the previous note. */
export function capLeap(
  prevDegree: number,
  candidateDegree: number,
  maxLeap: number = DEFAULT_MAX_LEAP,
): number {
  const delta = candidateDegree - prevDegree;
  if (delta > maxLeap) return prevDegree + maxLeap;
  if (delta < -maxLeap) return prevDegree - maxLeap;
  return candidateDegree;
}

// --- Phrase resolution ----------------------------------------------------

/** Pitch class (0–11) of a scale degree. */
function pitchClass(scale: Scale, degree: number): number {
  return ((degreeToSemitone(scale, degree) % 12) + 12) % 12;
}

/** Whether a degree lands on a stable tone (default: the tonic triad). */
export function isStableDegree(
  scale: Scale,
  degree: number,
  stable: readonly number[] = STABLE_PITCH_CLASSES,
): boolean {
  return stable.includes(pitchClass(scale, degree));
}

/**
 * The stable degree nearest to `degree` — used to resolve the last note of a
 * phrase onto a restful tone while keeping the contour. Searches outward; ties
 * resolve downward (a gentle landing toward the tonic). A scale always contains
 * its tonic, so a stable degree is always found within one octave either way.
 */
export function nearestStableDegree(
  scale: Scale,
  degree: number,
  stable: readonly number[] = STABLE_PITCH_CLASSES,
): number {
  for (let d = 0; d <= scale.length; d++) {
    if (isStableDegree(scale, degree - d, stable)) return degree - d;
    if (isStableDegree(scale, degree + d, stable)) return degree + d;
  }
  /* c8 ignore next -- unreachable: a scale's tonic is always stable and recurs each octave */
  return degree;
}

// --- Contour shaping ------------------------------------------------------

/** Overall melodic shape of a phrase. */
export type ContourShape = "arch" | "rising" | "falling" | "flat";

/**
 * Target height (in scale degrees, relative to the phrase's baseline) that the
 * melody should gravitate toward at position `index` of a `length`-note phrase.
 * `arch` rises to an apex mid-phrase then falls; `rising`/`falling` ramp; `flat`
 * is neutral. The melody biases its note choice toward this target.
 */
export function contourTarget(
  shape: ContourShape,
  index: number,
  length: number,
  amplitude: number,
): number {
  if (length <= 1) return 0;
  const t = index / (length - 1); // 0..1 across the phrase
  if (shape === "arch") return Math.sin(Math.PI * t) * amplitude;
  if (shape === "rising") return t * amplitude;
  if (shape === "falling") return (1 - t) * amplitude;
  return 0; // flat
}

// --- Anti-repeat ----------------------------------------------------------

/**
 * Whether adding `candidate` would exceed `maxRepeat` consecutive identical
 * notes, given the recent history (most-recent-last).
 */
export function exceedsRepeatLimit(
  recent: readonly number[],
  candidate: number,
  maxRepeat: number = DEFAULT_MAX_NOTE_REPEAT,
): boolean {
  let run = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i] === candidate) run++;
    else break;
  }
  return run + 1 > maxRepeat;
}

/**
 * A shuffle bag for motif variety: draws items in a reshuffled order each pass
 * (sampling without replacement), and never returns the same slot twice in a
 * row, so a phrase never stale-loops. Give it distinct items — it dedupes by
 * position, not by value. Deterministic given the injected {@link Rng}. With a
 * single item there is nothing to vary.
 */
export class ShuffleBag<T> {
  private readonly items: readonly T[];
  private order: number[] = [];
  private lastIndex: number | null = null;

  constructor(items: readonly T[]) {
    if (items.length === 0) {
      throw new RangeError("ShuffleBag requires at least one item");
    }
    this.items = [...items];
  }

  /** Draw the next item. */
  next(rng: Rng): T {
    if (this.order.length === 0) {
      this.refill(rng);
    }
    const index = this.order.pop() as number;
    this.lastIndex = index;
    return this.items[index] as T;
  }

  private refill(rng: Rng): void {
    const n = this.items.length;
    const indices = Array.from({ length: n }, (_, i) => i);
    // Fisher–Yates shuffle using the seeded Rng.
    for (let i = n - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [indices[i], indices[j]] = [indices[j] as number, indices[i] as number];
    }
    // We draw from the end, so guard against the very next draw repeating the
    // last item across the refill boundary (only possible when n > 1).
    if (n > 1 && indices[n - 1] === this.lastIndex) {
      [indices[n - 1], indices[0]] = [indices[0] as number, indices[n - 1] as number];
    }
    this.order = indices;
  }
}
