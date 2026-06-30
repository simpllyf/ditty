/**
 * Rhythm — the timing vocabulary the arranger draws on: a melodic-rhythm
 * generator with metric accents, a drum-groove library, and swing. Pure,
 * deterministic.
 *
 * Durations are accumulated in integer **grid steps** (sixteenth-note units), so
 * a bar's onsets tile it exactly with no floating-point drift; values are
 * converted to beats only at emit time.
 */
import { clampSafe as clamp } from "../math";
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

/**
 * A drum pattern: hit positions in beats, authored for a specific meter. The
 * meter (`beatsPerBar`) is a property of the groove because feel and meter are
 * inseparable — a waltz IS 3/4 — so choosing a groove also chooses the meter.
 */
export interface DrumGroove {
  /** The meter this groove is written for; all hit positions are in [0, beatsPerBar). */
  readonly beatsPerBar: number;
  readonly kick: readonly number[];
  readonly snare: readonly number[];
  readonly hat: readonly number[];
}

const EIGHTHS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
const SIXTEENTHS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75];

/** Drum grooves. Most are 4/4; `waltz` is 3/4 and `sixEight` a 6/8 lilt. Pick by style. */
export const DRUM_GROOVES = {
  straight: { beatsPerBar: 4, kick: [0, 2], snare: [1, 3], hat: EIGHTHS },
  fourOnFloor: { beatsPerBar: 4, kick: [0, 1, 2, 3], snare: [1, 3], hat: [0.5, 1.5, 2.5, 3.5] },
  halfTime: { beatsPerBar: 4, kick: [0], snare: [2], hat: EIGHTHS },
  soft: { beatsPerBar: 4, kick: [0, 2], snare: [], hat: [0, 1, 2, 3] },
  busy: { beatsPerBar: 4, kick: [0, 1.5, 2, 3.5], snare: [1, 3], hat: EIGHTHS },
  syncopated: { beatsPerBar: 4, kick: [0, 1.5, 2.5], snare: [1, 3], hat: EIGHTHS }, // off-beat kick push
  breakbeat: { beatsPerBar: 4, kick: [0, 0.75, 2.5], snare: [1, 3], hat: EIGHTHS }, // broken kick
  halfDouble: { beatsPerBar: 4, kick: [0], snare: [2], hat: SIXTEENTHS }, // slow backbeat, double-time hats
  waltz: { beatsPerBar: 3, kick: [0], snare: [1, 2], hat: [0, 1, 2] }, // 3/4 oom-pah-pah
  sixEight: { beatsPerBar: 6, kick: [0, 3], snare: [3], hat: [0, 1, 2, 3, 4, 5] }, // 6/8 compound lilt
  none: { beatsPerBar: 4, kick: [], snare: [], hat: [] },
} as const satisfies Record<string, DrumGroove>;

/** Name of a built-in drum groove. */
export type DrumGrooveName = keyof typeof DRUM_GROOVES;

/**
 * Clip a groove's hits to `beatsPerBar`. A safety net for the case where the
 * meter is overridden away from the groove's own (`DrumGroove.beatsPerBar`) — a
 * groove played in a shorter meter would otherwise schedule hits past the loop.
 */
export function fitGroove(groove: DrumGroove, beatsPerBar: number): DrumGroove {
  const fit = (positions: readonly number[]) => positions.filter((p) => p < beatsPerBar);
  return { beatsPerBar, kick: fit(groove.kick), snare: fit(groove.snare), hat: fit(groove.hat) };
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
