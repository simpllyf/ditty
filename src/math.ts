/**
 * Small numeric helpers shared across the library. Pure.
 */

/** Clamp `x` into `[lo, hi]`. */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Clamp into `[lo, hi]`, mapping NaN to the low bound. Use for values that feed a
 * Web Audio `AudioParam`, where a NaN would silently corrupt the parameter.
 */
export function clampSafe(x: number, lo: number, hi: number): number {
  return Number.isNaN(x) ? lo : Math.max(lo, Math.min(hi, x));
}
