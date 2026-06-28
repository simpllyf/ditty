/**
 * Deterministic white noise — the one stochastic ingredient the drum synth needs,
 * kept PURE and seeded so renders are reproducible and no `Math.random` ever
 * reaches the audio shell. The synth wraps the returned table into an AudioBuffer.
 */
import type { Rng } from "./rng";

/** 1 second at 44.1 kHz — plenty for short percussion hits read at varying offsets. */
export const DEFAULT_NOISE_LENGTH = 44_100;

/** Fill a table with white noise in [-1, 1) from a seeded {@link Rng}. Pure. */
export function makeNoiseTable(rng: Rng, length: number = DEFAULT_NOISE_LENGTH): Float32Array {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError(`makeNoiseTable length must be a positive integer, got ${length}`);
  }
  const table = new Float32Array(length);
  for (let i = 0; i < length; i++) table[i] = rng.next() * 2 - 1;
  return table;
}
