/**
 * Time — a grid of note durations and weighted selection over them.
 *
 * Durations are measured in integer **grid steps** (sixteenth-note units by
 * default), so a bar's durations sum to the bar length *exactly* with no
 * floating-point drift — the one hard invariant of this layer. Convert to beats
 * with {@link stepsToBeats} when handing off to the melody.
 */
import type { Rng } from "./rng";

/** A candidate note duration and its relative selection weight. */
export interface DurationWeight {
  /** Duration length in grid steps (sixteenth-note units by default). */
  readonly steps: number;
  /** Relative selection weight; must be positive. */
  readonly weight: number;
}

/** Configuration of the rhythmic grid and the durations that may appear on it. */
export interface RhythmConfig {
  /** Grid resolution: steps per beat. Default 4 (sixteenth notes). */
  readonly stepsPerBeat: number;
  /** Beats per bar. Default 4 (common time). */
  readonly beatsPerBar: number;
  /**
   * Candidate durations and weights. Must include a 1-step (grid-unit)
   * duration so that any leftover space in a bar can always be filled exactly.
   */
  readonly durations: readonly DurationWeight[];
}

/**
 * The peppy default: a sixteenth grid in common time, with eighths and quarters
 * dominant and the occasional sixteenth run or dotted value for bounce.
 */
export const DEFAULT_RHYTHM: RhythmConfig = {
  stepsPerBeat: 4,
  beatsPerBar: 4,
  durations: [
    { steps: 1, weight: 2 }, // sixteenth — occasional runs
    { steps: 2, weight: 7 }, // eighth — dominant
    { steps: 3, weight: 2 }, // dotted eighth — bounce
    { steps: 4, weight: 5 }, // quarter — dominant
    { steps: 6, weight: 1 }, // dotted quarter
    { steps: 8, weight: 1 }, // half — breath
  ],
};

/** Total grid steps in one bar. */
export function barLengthSteps(config: RhythmConfig = DEFAULT_RHYTHM): number {
  return config.stepsPerBeat * config.beatsPerBar;
}

/** Convert a duration in grid steps to beats. */
export function stepsToBeats(steps: number, config: RhythmConfig = DEFAULT_RHYTHM): number {
  return steps / config.stepsPerBeat;
}

function assertValidConfig(config: RhythmConfig): void {
  if (!Number.isInteger(config.stepsPerBeat) || config.stepsPerBeat < 1) {
    throw new RangeError(`rhythm stepsPerBeat must be an integer >= 1, got ${config.stepsPerBeat}`);
  }
  if (!Number.isInteger(config.beatsPerBar) || config.beatsPerBar < 1) {
    throw new RangeError(`rhythm beatsPerBar must be an integer >= 1, got ${config.beatsPerBar}`);
  }
  if (config.durations.length === 0) {
    throw new RangeError("rhythm config requires at least one duration");
  }
  let hasUnit = false;
  for (const { steps, weight } of config.durations) {
    if (!Number.isInteger(steps) || steps < 1) {
      throw new RangeError(`rhythm duration steps must be an integer >= 1, got ${steps}`);
    }
    if (!(weight > 0)) {
      throw new RangeError(`rhythm duration weight must be positive, got ${weight}`);
    }
    if (steps === 1) {
      hasUnit = true;
    }
  }
  if (!hasUnit) {
    throw new RangeError("rhythm config must include a 1-step duration so bars can fill exactly");
  }
}

/**
 * Pick a single duration (in grid steps) by weight, over the whole candidate
 * set. Unconstrained — see {@link generateBar} for bar-filling.
 */
export function weightedDuration(rng: Rng, config: RhythmConfig = DEFAULT_RHYTHM): number {
  assertValidConfig(config);
  return rng.weighted(
    config.durations.map((d) => d.steps),
    config.durations.map((d) => d.weight),
  );
}

/**
 * Generate one bar of durations (in grid steps) that sums to the bar length
 * **exactly**. Each pick is weighted over the durations that still fit in the
 * remaining space; the required 1-step unit guarantees an exact finish.
 */
export function generateBar(rng: Rng, config: RhythmConfig = DEFAULT_RHYTHM): number[] {
  assertValidConfig(config);
  const total = barLengthSteps(config);
  const bar: number[] = [];
  let remaining = total;
  while (remaining > 0) {
    const fitting = config.durations.filter((d) => d.steps <= remaining);
    const steps = rng.weighted(
      fitting.map((d) => d.steps),
      fitting.map((d) => d.weight),
    );
    bar.push(steps);
    remaining -= steps;
  }
  return bar;
}
