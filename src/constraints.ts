/**
 * Musicality — pure constraints that turn a raw walk into something intentional:
 * a leap cap for mostly-stepwise motion, a gentle contour bias, and anti-repeat
 * guards so motifs recur without staling. "Pleasant by constraint, not cleverness."
 *
 * Everything operates on integer **scale degrees**. The melody composes the
 * contour and anti-repeat helpers; the leap/shuffle utilities are exposed on
 * `/core` for building custom layers.
 */
import type { Rng } from "./rng";

/** Default maximum jump between consecutive notes, in scale degrees. */
export const DEFAULT_MAX_LEAP = 4;
/** Default cap on how many times one note may sound in a row. */
export const DEFAULT_MAX_NOTE_REPEAT = 2;

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
