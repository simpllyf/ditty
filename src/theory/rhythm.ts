/**
 * Rhythm — the timing vocabulary the arranger draws on: a melodic-rhythm
 * generator with metric accents, a drum-groove library, and swing. Pure,
 * deterministic.
 *
 * Durations are accumulated in integer **grid steps** (sixteenth-note units), so
 * a bar's onsets tile it exactly with no floating-point drift; values are
 * converted to beats only at emit time.
 */
import { clamp } from "../math";
import type { Rng } from "../rng";

/** Grid resolution: steps per beat (sixteenth notes). */
export const STEPS_PER_BEAT = 4;

/** A note onset within a bar. */
export interface Onset {
  /** Start, in beats from the bar's downbeat. */
  readonly startBeat: number;
  /** Duration in beats. */
  readonly durationBeats: number;
  /** Whether this onset lands on a strong metric position (for chord-tone placement). */
  readonly strong: boolean;
}

/**
 * Metric strength of a position within a bar, 0..1: downbeat (1) > even-meter
 * midpoint (0.8) > other on-beats (0.5) > offbeat eighths (0.3) > finer (0.15).
 * Meter-aware so 3/4 is strong-weak-weak (only the downbeat is strong).
 */
export function metricStrength(startBeat: number, beatsPerBar: number): number {
  if (startBeat === 0) return 1;
  if (beatsPerBar % 2 === 0 && startBeat === beatsPerBar / 2) return 0.8;
  if (Number.isInteger(startBeat)) return 0.5;
  if (startBeat % 1 === 0.5) return 0.3;
  return 0.15;
}

/** A position is "strong" (gets a chord tone) at the downbeat or an even-meter midpoint. */
const STRONG_THRESHOLD = 0.8;

// Subdivision patterns for one beat, in grid steps (each sums to STEPS_PER_BEAT).
const PATTERNS: ReadonlyArray<readonly number[]> = [
  [4], // quarter
  [2, 2], // two eighths
  [2, 1, 1], // eighth + two sixteenths
  [1, 1, 2], // two sixteenths + eighth
  [3, 1], // dotted eighth + sixteenth
  [1, 1, 1, 1], // four sixteenths
];
const BASE_WEIGHTS: readonly number[] = [3, 6, 3, 2, 2, 1];

/**
 * Generate one bar of melodic onsets that tile the bar exactly. `density` (0..1,
 * default 0.5) biases toward busier (1) or sparser (0) subdivisions. Deterministic.
 */
export function melodyRhythm(
  rng: Rng,
  beatsPerBar: number,
  options: { density?: number } = {},
): Onset[] {
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1) {
    throw new RangeError(`melodyRhythm beatsPerBar must be an integer >= 1, got ${beatsPerBar}`);
  }
  const density = clamp(options.density ?? 0.5, 0, 1);
  const tilt = (density - 0.5) * 2; // -1..1
  const weights = PATTERNS.map((p, i) => (BASE_WEIGHTS[i] as number) * p.length ** tilt);

  const onsets: Onset[] = [];
  let step = 0; // integer grid steps from the bar start
  for (let beat = 0; beat < beatsPerBar; beat++) {
    for (const durSteps of rng.weighted(PATTERNS, weights)) {
      const startBeat = step / STEPS_PER_BEAT;
      onsets.push({
        startBeat,
        durationBeats: durSteps / STEPS_PER_BEAT,
        strong: metricStrength(startBeat, beatsPerBar) >= STRONG_THRESHOLD,
      });
      step += durSteps;
    }
  }
  return onsets;
}

/** A drum pattern: hit positions in beats (authored for 4/4). */
export interface DrumGroove {
  readonly kick: readonly number[];
  readonly snare: readonly number[];
  readonly hat: readonly number[];
}

const EIGHTHS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];

/** Drum grooves, authored in 4/4 (positions 0..3.5). Pick by style; combine with {@link fitGroove}. */
export const DRUM_GROOVES = {
  straight: { kick: [0, 2], snare: [1, 3], hat: EIGHTHS },
  fourOnFloor: { kick: [0, 1, 2, 3], snare: [1, 3], hat: [0.5, 1.5, 2.5, 3.5] },
  halfTime: { kick: [0], snare: [2], hat: EIGHTHS },
  soft: { kick: [0, 2], snare: [], hat: [0, 1, 2, 3] },
  busy: { kick: [0, 1.5, 2, 3.5], snare: [1, 3], hat: EIGHTHS },
  none: { kick: [], snare: [], hat: [] },
} as const satisfies Record<string, DrumGroove>;

/** Name of a built-in drum groove. */
export type DrumGrooveName = keyof typeof DRUM_GROOVES;

/**
 * Restrict a groove to a meter by dropping hits at/after `beatsPerBar`.
 * Filter-only: grooves are authored for 4/4, so longer meters (5–6) leave later
 * beats empty and 3/4 drops the beat-3 hits — the arranger should pick a
 * meter-appropriate groove rather than rely on filling.
 */
export function fitGroove(groove: DrumGroove, beatsPerBar: number): DrumGroove {
  const fit = (positions: readonly number[]) => positions.filter((p) => p < beatsPerBar);
  return { kick: fit(groove.kick), snare: fit(groove.snare), hat: fit(groove.hat) };
}

/** Maximum swing offset, in beats — a 2:1 (triplet) feel at amount 1; < a sixteenth, so onsets never reorder. */
export const SWING_MAX = 1 / 6;

/**
 * Apply swing to a beat position: only the offbeat eighth (`x.5`) is delayed, by
 * up to {@link SWING_MAX}. Identity at amount 0; monotonic in amount; never
 * crosses the following sixteenth (`x.75`) or the next beat, so order is preserved.
 */
export function applySwing(position: number, amount: number): number {
  if (position % 1 !== 0.5) return position;
  return position + clamp(amount, 0, 1) * SWING_MAX;
}
