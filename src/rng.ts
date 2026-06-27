/**
 * Seeded pseudo-random number generator — the heart of the engine's
 * determinism (spec §10). Given a seed, every method produces an identical
 * sequence across runs and platforms, so the entire musical event stream is
 * reproducible byte-for-byte. **No `Math.random()` lives anywhere in the
 * engine**; all randomness flows through here.
 *
 * The algorithm is mulberry32: a single 32-bit state, fast, with distribution
 * quality that is more than good enough for music. If that ever stops being
 * true, swap the internals for `xoshiro128**` behind this same {@link Rng}
 * interface — nothing else in the engine may care.
 */
export interface Rng {
  /** Next float in `[0, 1)`. */
  next(): number;
  /** Next integer in `[0, maxExclusive)`. `maxExclusive` must be >= 1. */
  int(maxExclusive: number): number;
  /** Uniformly pick one item. The array must be non-empty. */
  pick<T>(items: readonly T[]): T;
  /**
   * Pick one item with probability proportional to its weight. `items` and
   * `weights` must be the same non-zero length, weights non-negative with a
   * positive sum.
   */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /**
   * Derive an independent child stream. Use this to give separate concerns
   * (melody vs. rhythm vs. stingers) their own uncorrelated randomness from the
   * one seed. Calling `fork()` consumes one step of this stream, so the parent
   * stays deterministic and successive forks differ.
   */
  fork(): Rng;
}

const UINT32 = 0x1_0000_0000;

/** Create a seeded {@link Rng}. The seed is coerced to a 32-bit integer. */
export function makeRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };

  const int = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
      throw new RangeError(`int(maxExclusive) requires an integer >= 1, got ${maxExclusive}`);
    }
    return Math.floor(next() * maxExclusive);
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new RangeError("pick() requires a non-empty array");
    }
    return items[int(items.length)] as T;
  };

  const weighted = <T>(items: readonly T[], weights: readonly number[]): T => {
    if (items.length === 0) {
      throw new RangeError("weighted() requires a non-empty array");
    }
    if (items.length !== weights.length) {
      throw new RangeError(
        `weighted() needs items and weights of equal length (${items.length} vs ${weights.length})`,
      );
    }
    let total = 0;
    for (const weight of weights) {
      if (!(weight >= 0)) {
        throw new RangeError(`weighted() requires non-negative weights, got ${weight}`);
      }
      total += weight;
    }
    if (total <= 0) {
      throw new RangeError("weighted() requires the weights to sum to a positive number");
    }
    let threshold = next() * total;
    for (let i = 0; i < items.length; i++) {
      threshold -= weights[i] as number;
      if (threshold < 0) {
        return items[i] as T;
      }
    }
    // Floating-point drift can leave threshold marginally >= 0 after the loop;
    // the last positive-weight item is the correct fallback.
    for (let i = items.length - 1; i >= 0; i--) {
      if ((weights[i] as number) > 0) {
        return items[i] as T;
      }
    }
    /* c8 ignore next -- unreachable: a positive total guarantees a positive weight */
    throw new RangeError("weighted() could not select an item");
  };

  const fork = (): Rng => makeRng((next() * UINT32) >>> 0);

  return { next, int, pick, weighted, fork };
}
