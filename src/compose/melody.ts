/**
 * Harmony-aware melody — the line that follows the chords. Strong beats land on
 * chord tones, weak beats step between, a phrase contour shapes the arc, and the
 * cadence bars resolve. Pure and deterministic; the arranger turns degrees into
 * sound. Coherence comes from following the {@link HarmonicPlan}.
 */
import { type ContourShape, contourTarget, exceedsRepeatLimit } from "../constraints";
import { clamp } from "../math";
import type { Rng } from "../rng";
import { pitchClass } from "../theory/pitch";
import { melodyRhythm } from "../theory/rhythm";
import { type RagaPaths, type Scale, degreePitchClass } from "../theory/scales";
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
  /**
   * Directional grammar (arohana/avarohana): which of the raga's notes the line may
   * touch going up versus coming down. Omit for a raga that moves the same way both
   * ways. See {@link RagaPaths}.
   */
  paths?: RagaPaths;
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
  /** Phrase contour shape — the arc the line gravitates toward. Default "arch". */
  contour?: ContourShape;
  /** Contour amplitude, in degrees. Default 4. */
  contourAmplitude?: number;
  /** Rhythm density 0..1. Default 0.5. */
  density?: number;
  /** Base lead velocity 0..1. Default 0.7. */
  velocity?: number;
  /**
   * The piece's theme: a fixed opening phrase stated at the head, before generated
   * continuation takes over. Degrees are raga-relative, so the same motif auto-transposes
   * when a section modulates — a recurring, recognisable tune. Callers hand in the theme
   * already developed for this section (see {@link developMotif}).
   */
  motif?: readonly MelodyNote[];
  /** Bars the {@link motif} spans; continuation generates from here on. Default 0. */
  motifBars?: number;
}

const DEFAULT_RANGE: readonly [number, number] = [0, 7];

/** Arohana/avarohana as pitch-class sets, or null for a raga that moves alike both ways. */
type PathSets = { readonly up: ReadonlySet<number>; readonly down: ReadonlySet<number> } | null;

/**
 * Narrow a pool to the notes the raga permits when approached from `from`: rising
 * notes must lie on the arohana, falling ones on the avarohana; holding a note is
 * always free. If nothing qualifies the pool stands — the grammar shapes the line,
 * it never strands it.
 */
function onPath(
  pool: readonly number[],
  from: number,
  pcOf: (degree: number) => number,
  paths: PathSets,
): readonly number[] {
  if (!paths) return pool;
  const legal = pool.filter(
    (d) => d === from || (d > from ? paths.up.has(pcOf(d)) : paths.down.has(pcOf(d))),
  );
  return legal.length > 0 ? legal : pool;
}

/** Default max jump between consecutive notes, in degrees. */
export const DEFAULT_MAX_LEAP = 4;

/** Generate the lead line for a whole {@link HarmonicPlan}. Absolute start beats. */
export function generateMelody(options: MelodyOptions): MelodyNote[] {
  const { rng, plan } = options;
  const scale = options.scale ?? plan.scale;
  const [lo, hi] = options.range ?? DEFAULT_RANGE;
  const maxLeap = options.maxLeap ?? DEFAULT_MAX_LEAP;
  const maxNoteRepeat = options.maxNoteRepeat ?? 2;
  const amplitude = options.contourAmplitude ?? 4;
  const contour = options.contour ?? "arch";
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
  const paths: PathSets = options.paths
    ? {
        up: new Set(options.paths.up.map(pitchClass)),
        down: new Set(options.paths.down.map(pitchClass)),
      }
    : null;

  const inRange: number[] = [];
  for (let d = lo; d <= hi; d++) inRange.push(d);

  /**
   * Where a written theme note actually lands: the degree nearest what was written
   * that this bar's harmony and the raga's grammar both allow. Nearest keeps the
   * theme's contour, and chord tones are chosen before the path narrows, so on a
   * strong beat the harmony still wins.
   */
  const stateNote = (written: number, pcs: readonly number[], strong: boolean, from: number) => {
    let pool: readonly number[] = inRange;
    if (strong && pcs.length > 0) {
      const tones = pool.filter((d) => pcs.includes(pcOf(d)));
      if (tones.length > 0) pool = tones;
    }
    const legal = onPath(pool, from, pcOf, paths);
    return legal.reduce(
      (best, d) => (Math.abs(d - written) < Math.abs(best - written) ? d : best),
      legal[0] as number,
    );
  };

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
    // The cadence still has to reach its resolution the way the raga moves.
    const legal = onPath(pool, prev, pcOf, paths);
    return legal.reduce(
      (best, d) => (Math.abs(d - prev) < Math.abs(best - prev) ? d : best),
      legal[0] as number,
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

  // State the theme at the head (if any), then generate the continuation from where it
  // left off — so every section opens with the recognisable tune. The motif is drawn
  // once over section A and may arrive here transformed, so each note is re-fitted to
  // the chord this section puts under it and to the raga's grammar; landing on the
  // nearest degree that satisfies both keeps the theme's shape.
  let startBar = 0;
  const motif = options.motif;
  if (motif && motif.length > 0) {
    for (const n of motif) {
      const bar = Math.min(Math.floor(n.startBeat / plan.beatsPerBar), plan.bars.length - 1);
      const chordRagaPcs = plan.bars[bar]!.chord.pcs.filter((pc) => ragaPcs.has(pc));
      const degree = stateNote(n.degree, chordRagaPcs, n.strong, prev);
      notes.push(degree === n.degree ? n : { ...n, degree });
      remember(degree);
      prev = degree;
    }
    startBar = options.motifBars ?? 0;
  }

  for (let bar = startBar; bar < plan.bars.length; bar++) {
    const chord = plan.bars[bar]!.chord;
    const chordRagaPcs = chord.pcs.filter((pc) => ragaPcs.has(pc)); // raga ∩ chord (set hoisted)
    // Phrases run four bars (the span the contour arcs over), and the cadence bars close
    // one too. Ending a phrase lands, holds, then breathes — so a cadence's resolution
    // rings out into silence instead of being trampled by the next note.
    const phraseEnd = bar % 4 === 3 || bar === plan.cadences.half || bar === plan.cadences.final;
    const onsets = melodyRhythm(rng, plan.beatsPerBar, { density, phraseEnd });

    for (let i = 0; i < onsets.length; i++) {
      const onset = onsets[i]!;
      const isLast = i === onsets.length - 1;
      const phraseT = ((bar % 4) + onset.startBeat / plan.beatsPerBar) / 4; // 0..1 across a 4-bar phrase
      // Soft-bias each note toward the phrase's contour; pickNote still enforces key + leap cap.
      const target = clamp(
        home + Math.round(contourTarget(contour, phraseT, 2, amplitude)),
        lo,
        hi,
      );

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
          paths,
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
  /** Arohana/avarohana pitch classes, or null when the raga moves alike both ways. */
  paths: PathSets;
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

  // Narrow WITHIN the chord tones, so on a strong beat the harmony still wins — the
  // honest trade for a grammar that assumes a drone sitting over functional chords.
  candidates = [...onPath(candidates, a.prev, a.pcOf, a.paths)];

  // Avoid extending a stale repeat when an alternative exists.
  const nonRepeat = candidates.filter((d) => !exceedsRepeatLimit(a.recent, d, a.maxNoteRepeat));
  if (nonRepeat.length > 0) candidates = nonRepeat;

  const weights = candidates.map(
    (d) => (1 / (1 + Math.abs(d - a.target))) * (1 / (1 + Math.abs(d - a.prev))),
  );
  return rng.weighted(candidates, weights);
}
