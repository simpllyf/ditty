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
 * Metric strength of a position within a bar, 0..1: downbeat (1) > secondary accent
 * (0.8) > other on-beats (0.5) > offbeat eighths (0.3) > finer (0.15). Meter-aware so
 * 3/4 is strong-weak-weak (only the downbeat is strong).
 *
 * `accents` names the secondary accents explicitly, for a cycle whose stresses aren't
 * where an even meter would put them — a tala is grouped (3+2+2), not halved, so its
 * accents fall on the anga boundaries and a 7-beat cycle has no midpoint at all.
 * Omit it and the accent is the even-meter midpoint, as before.
 */
export function metricStrength(
  startBeat: number,
  beatsPerBar: number,
  accents?: readonly number[],
): number {
  if (startBeat === 0) return 1;
  const accented = accents
    ? accents.includes(startBeat)
    : beatsPerBar % 2 === 0 && startBeat === beatsPerBar / 2;
  if (accented) return 0.8;
  if (Number.isInteger(startBeat)) return 0.5;
  if (startBeat % 1 === 0.5) return 0.3;
  return 0.15;
}

/** A position is "strong" (gets a chord tone) at the downbeat or an even-meter midpoint. */
export const STRONG_THRESHOLD = 0.8;

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

/** What a beat does: sound new notes, sustain the previous one, or stay silent. */
const BEAT_MODES = ["active", "held", "rest"] as const;
type BeatMode = (typeof BEAT_MODES)[number];

/**
 * Generate one bar of melodic onsets. Onsets are ordered and non-overlapping within
 * the bar, but they do NOT tile it: the gaps between them are rests, and a note may
 * be sustained across beats — a line has to breathe and hold to sound sung rather
 * than typed.
 *
 * Each beat picks a mode: sound new notes (subdividing as before), sustain the
 * previous note through this beat, or rest. `density` (0..1, default 0.5) biases both
 * the subdivision and how often a beat sounds at all. The downbeat always sounds, so
 * every bar is anchored and the harmony still lands on beat one.
 *
 * `phraseEnd` shapes the bar as land → hold → breathe: the melody arrives on the
 * downbeat, sustains, then leaves the rest of the bar silent. That is where a sung
 * phrase takes its breath — and where a cadence's resolution note wants to ring.
 * Deterministic.
 */
export function melodyRhythm(
  rng: Rng,
  beatsPerBar: number,
  options: { density?: number; phraseEnd?: boolean; accents?: readonly number[] } = {},
): Onset[] {
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1) {
    throw new RangeError(`melodyRhythm beatsPerBar must be an integer >= 1, got ${beatsPerBar}`);
  }
  const density = clamp(options.density ?? 0.5, 0, 1);
  const tilt = (density - 0.5) * 2; // -1..1
  const weights = PATTERNS.map((p, i) => (BASE_WEIGHTS[i] as number) * p.length ** tilt);
  // Denser → beats sound more often and rest less; `held` stays steady so sustains
  // remain available at every density.
  const modeWeights = [3 + 4 * density, 2, 4 - 2 * density];

  const onsets: Onset[] = [];
  let step = 0; // integer grid steps from the bar start; every mode consumes one beat
  const sound = () => {
    for (const durSteps of rng.weighted(PATTERNS, weights)) {
      const startBeat = step / STEPS_PER_BEAT;
      onsets.push({
        startBeat,
        durationBeats: durSteps / STEPS_PER_BEAT,
        strong: metricStrength(startBeat, beatsPerBar, options.accents) >= STRONG_THRESHOLD,
      });
      step += durSteps;
    }
  };
  // Sustain the previous note through this beat — only when it ends exactly here, so a
  // note is never resurrected across a rest. `strong` stays as drawn: it describes where
  // the note BEGAN.
  const sustain = (): boolean => {
    const last = onsets[onsets.length - 1];
    if (!last || (last.startBeat + last.durationBeats) * STEPS_PER_BEAT !== step) return false;
    onsets[onsets.length - 1] = { ...last, durationBeats: last.durationBeats + 1 };
    step += STEPS_PER_BEAT;
    return true;
  };

  // A phrase-ending bar holds for roughly a third of the bar, then breathes out.
  const holdUntil = 1 + Math.max(1, Math.floor(beatsPerBar / 3));

  for (let beat = 0; beat < beatsPerBar; beat++) {
    if (beat === 0) {
      sound(); // always land the downbeat
      continue;
    }
    let mode: BeatMode;
    if (options.phraseEnd) mode = beat < holdUntil ? "held" : "rest";
    else mode = rng.weighted(BEAT_MODES, modeWeights);

    if (mode === "rest") step += STEPS_PER_BEAT;
    else if (mode === "held" && sustain()) continue;
    else sound(); // "active", or a hold with nothing contiguous to extend
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

  // ── talas ──
  // A tala is a fixed cycle of angas (counted groups), and the cycle IS the meter — so a
  // tala is a groove like any other here and the meter falls out of it. The kit marks the
  // structure the hands do: a deep stroke on the sam (the cycle's first beat, the point
  // everything resolves to), a sharper stroke where each following anga begins, and a steady
  // count underneath. Sparse on purpose — the drone and the raga carry the music.
  adi: { beatsPerBar: 8, kick: [0], snare: [4, 6], hat: [0, 1, 2, 3, 4, 5, 6, 7] }, // 4+2+2
  rupaka: { beatsPerBar: 6, kick: [0], snare: [2], hat: [0, 1, 2, 3, 4, 5] }, // 2+4
  misraChapu: { beatsPerBar: 7, kick: [0], snare: [3, 5], hat: [0, 1, 2, 3, 4, 5, 6] }, // 3+2+2
} as const satisfies Record<string, DrumGroove>;

/**
 * The talas, in the order a piece may draw one. Named separately from {@link DRUM_GROOVES}
 * so raga mode picks a CYCLE rather than a Western groove — the styles keep listing their
 * own grooves explicitly, so a tala never leaks into a fusion track.
 */
export const TALAS = ["adi", "rupaka", "misraChapu"] as const satisfies readonly DrumGrooveName[];

/** A tala's angas — the counted groups its cycle divides into. Their sum is the meter. */
export const TALA_ANGAS = {
  adi: [4, 2, 2], // laghu + drutam + drutam
  rupaka: [2, 4], // drutam + laghu
  misraChapu: [3, 2, 2],
} as const satisfies Record<(typeof TALAS)[number], readonly number[]>;

export type TalaName = keyof typeof TALA_ANGAS;

/** Is this groove a tala (a counted cycle) rather than a Western groove? */
export function isTala(groove: string): groove is TalaName {
  return groove in TALA_ANGAS;
}

/**
 * Where each anga begins, in beats from the sam. These are the cycle's stresses — the
 * points a phrase leans on and resolves to. A tala is GROUPED, not halved, so they are
 * not the even-meter accents: Misra Chapu (3+2+2) leans on 3 and 5 and has no midpoint
 * at all, and Rupaka (2+4) leans on 2 rather than on its middle.
 */
export function angaStarts(tala: TalaName): number[] {
  const starts: number[] = [0];
  let at = 0;
  for (const anga of TALA_ANGAS[tala].slice(0, -1)) {
    at += anga;
    starts.push(at);
  }
  return starts;
}

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
