/**
 * Harmony-aware melody — the line that follows the chords. Strong beats land on
 * chord tones, weak beats step between, a gentle arch shapes each phrase, and the
 * cadence bars resolve. Pure and deterministic; the arranger turns degrees into
 * sound. Coherence comes from following the {@link HarmonicPlan}.
 */
import { contourTarget, exceedsRepeatLimit } from "../constraints";
import { clamp } from "../math";
import type { Rng } from "../rng";
import { pitchClass } from "../theory/pitch";
import { melodyRhythm } from "../theory/rhythm";
import { type Scale, degreePitchClass } from "../theory/scales";
import type { HarmonicPlan } from "./harmony";

/** One melody note. `degree` is a melody-scale degree (any integer); the arranger maps it to Hz. */
export interface MelodyNote {
  readonly startBeat: number;
  readonly durationBeats: number;
  readonly degree: number;
  readonly velocity: number;
  readonly strong: boolean;
}

export interface MelodyOptions {
  rng: Rng;
  /** The harmony to follow (chords per bar + cadence markers). */
  plan: HarmonicPlan;
  /** Melody raga. Default: the plan's parent scale. May be pentatonic. */
  scale?: Scale;
  /** Melody-degree range `[low, high]` (span >= 2). Default `[0, 7]`. */
  range?: readonly [number, number];
  /** Max jump between consecutive notes, in degrees. Default 4. */
  maxLeap?: number;
  /**
   * Soft cap on consecutive identical notes (default 2). A forced chord tone on
   * a strong beat or a cadence resolution may extend a run by one, so the hard
   * bound is `maxNoteRepeat + 1`.
   */
  maxNoteRepeat?: number;
  /** Contour amplitude, in degrees. Default 4. */
  contourAmplitude?: number;
  /** Rhythm density 0..1. Default 0.5. */
  density?: number;
  /** Base lead velocity 0..1. Default 0.7. */
  velocity?: number;
  /**
   * The piece's theme: a fixed opening phrase stated VERBATIM at the head, before
   * generated continuation takes over. Degrees are raga-relative, so the same motif
   * auto-transposes when a section modulates — a recurring, recognisable tune.
   */
  motif?: readonly MelodyNote[];
  /** Bars the {@link motif} spans; continuation generates from here on. Default 0. */
  motifBars?: number;
}

const DEFAULT_RANGE: readonly [number, number] = [0, 7];

/** Generate the lead line for a whole {@link HarmonicPlan}. Absolute start beats. */
export function generateMelody(options: MelodyOptions): MelodyNote[] {
  const { rng, plan } = options;
  const scale = options.scale ?? plan.scale;
  const [lo, hi] = options.range ?? DEFAULT_RANGE;
  const maxLeap = options.maxLeap ?? 4;
  const maxNoteRepeat = options.maxNoteRepeat ?? 2;
  const amplitude = options.contourAmplitude ?? 4;
  const density = options.density ?? 0.5;
  const baseVelocity = clamp(options.velocity ?? 0.7, 0, 1);

  if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi - lo < 1) {
    throw new RangeError(`melody range must be integers spanning >= 2 degrees, got [${lo}, ${hi}]`);
  }
  if (!Number.isInteger(maxLeap) || maxLeap < 1) {
    throw new RangeError(`melody maxLeap must be an integer >= 1, got ${maxLeap}`);
  }
  if (!Number.isInteger(maxNoteRepeat) || maxNoteRepeat < 1) {
    throw new RangeError(`melody maxNoteRepeat must be an integer >= 1, got ${maxNoteRepeat}`);
  }
  if (!(amplitude >= 0)) {
    throw new RangeError(`melody contourAmplitude must be >= 0, got ${amplitude}`);
  }

  const home = Math.round((lo + hi) / 2);
  const pcOf = (degree: number) => degreePitchClass(scale, degree);
  const ragaPcs = new Set(scale.map(pitchClass)); // loop-invariant: the raga's pitch classes

  const notes: MelodyNote[] = [];
  const recent: number[] = [];
  const remember = (degree: number) => {
    recent.push(degree);
    if (recent.length > maxNoteRepeat) recent.shift();
  };

  /**
   * Resolve a cadence onto a target pitch class set, staying WITHIN the leap cap
   * and avoiding a stale repeat when possible (so both caps stay hard). Falls
   * back to the nearest in-leap degree if no target tone is reachable.
   */
  const resolveTo = (pcs: readonly number[]): number => {
    const inLeap = leapWindow(prev, lo, hi, maxLeap);
    const matches = inLeap.filter((d) => pcs.includes(pcOf(d)));
    const fresh = (pool: number[]) =>
      pool.filter((d) => !exceedsRepeatLimit(recent, d, maxNoteRepeat));
    const pool =
      [fresh(matches), matches, fresh(inLeap), inLeap].find((t) => t.length > 0) ?? inLeap;
    return pool.reduce(
      (best, d) => (Math.abs(d - prev) < Math.abs(best - prev) ? d : best),
      pool[0] as number,
    );
  };

  // Open on the in-range tonic nearest home (or the low bound if the raga has none).
  let prev = lo;
  let openDist = Infinity;
  for (let d = lo; d <= hi; d++) {
    if (pcOf(d) !== 0) continue;
    const dist = Math.abs(d - home);
    if (dist < openDist) {
      openDist = dist;
      prev = d;
    }
  }

  // State the theme verbatim at the head (if any), then generate the continuation
  // from where it left off — so every section opens with the recognisable tune.
  let startBar = 0;
  const motif = options.motif;
  if (motif && motif.length > 0) {
    for (const n of motif) {
      notes.push(n);
      remember(n.degree);
      prev = n.degree;
    }
    startBar = options.motifBars ?? 0;
  }

  for (let bar = startBar; bar < plan.bars.length; bar++) {
    const chord = plan.bars[bar]!.chord;
    const chordRagaPcs = chord.pcs.filter((pc) => ragaPcs.has(pc)); // raga ∩ chord (set hoisted)
    const onsets = melodyRhythm(rng, plan.beatsPerBar, { density });

    for (let i = 0; i < onsets.length; i++) {
      const onset = onsets[i]!;
      const isLast = i === onsets.length - 1;
      const phraseT = ((bar % 4) + onset.startBeat / plan.beatsPerBar) / 4; // 0..1 across a 4-bar phrase
      // contourTarget("arch", t, 2, amp) === sin(π·t)·amp — an arch peaking mid-phrase.
      const target = clamp(home + Math.round(contourTarget("arch", phraseT, 2, amplitude)), lo, hi);

      let degree: number;
      if (isLast && bar === plan.cadences.final) {
        degree = resolveTo([0]); // resolve to the tonic
      } else if (isLast && bar === plan.cadences.half) {
        degree = resolveTo(chordRagaPcs.length > 0 ? chordRagaPcs : chord.pcs); // open on a V chord tone
      } else {
        degree = pickNote(rng, {
          prev,
          lo,
          hi,
          maxLeap,
          target,
          pcOf,
          chordPcs: onset.strong && chordRagaPcs.length > 0 ? chordRagaPcs : null,
          recent,
          maxNoteRepeat,
        });
      }

      notes.push({
        startBeat: bar * plan.beatsPerBar + onset.startBeat,
        durationBeats: onset.durationBeats,
        degree,
        velocity: onset.strong ? baseVelocity : baseVelocity * 0.82,
        strong: onset.strong,
      });
      remember(degree);
      prev = degree;
    }
  }

  return notes;
}

interface PickArgs {
  prev: number;
  lo: number;
  hi: number;
  maxLeap: number;
  target: number;
  pcOf: (degree: number) => number;
  chordPcs: readonly number[] | null; // non-null on a strong beat → restrict to chord tones
  recent: number[];
  maxNoteRepeat: number;
}

/** The in-range degrees reachable from `prev` within the leap cap. */
function leapWindow(prev: number, lo: number, hi: number, maxLeap: number): number[] {
  const window: number[] = [];
  for (let d = Math.max(lo, prev - maxLeap); d <= Math.min(hi, prev + maxLeap); d++) {
    window.push(d);
  }
  return window;
}

/** Weighted choice within the leap window, biased toward the contour target and stepwise motion. */
function pickNote(rng: Rng, a: PickArgs): number {
  const inLeap = leapWindow(a.prev, a.lo, a.hi, a.maxLeap);
  const chordTones = a.chordPcs ? inLeap.filter((d) => a.chordPcs!.includes(a.pcOf(d))) : [];
  let candidates = chordTones.length > 0 ? chordTones : inLeap;

  // Avoid extending a stale repeat when an alternative exists.
  const nonRepeat = candidates.filter((d) => !exceedsRepeatLimit(a.recent, d, a.maxNoteRepeat));
  if (nonRepeat.length > 0) candidates = nonRepeat;

  const weights = candidates.map(
    (d) => (1 / (1 + Math.abs(d - a.target))) * (1 / (1 + Math.abs(d - a.prev))),
  );
  return rng.weighted(candidates, weights);
}
