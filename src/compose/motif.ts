/**
 * Motif development — how a theme EVOLVES rather than merely recurring. A motif
 * restated note-for-note in every section is a loop; one that is sequenced,
 * mirrored, broadened, or broken down to its head is a piece of music. These are
 * the classical development devices, and they are what makes a listener hear
 * composition rather than repetition.
 *
 * Every transform works in SCALE-DEGREE space, so a developed theme lands back
 * inside the raga by construction — no transposition can import a foreign note.
 * Pure and deterministic: data in, data out.
 */
import { clamp } from "../math";
import { STRONG_THRESHOLD, metricStrength } from "../theory/rhythm";
import type { MelodyNote } from "./melody";

/** The development devices a section may apply to the theme. */
export const MOTIF_TRANSFORMS = [
  "statement",
  "sequence",
  "inversion",
  "augmentation",
  "fragmentation",
] as const;

export type MotifTransform = (typeof MOTIF_TRANSFORMS)[number];

/** How one section treats the theme. */
export interface MotifDevelopment {
  readonly transform: MotifTransform;
  /** Degrees of lift: the interval a `sequence` moves by, and the rise between `fragmentation` repeats. */
  readonly step: number;
}

/** The theme as itself — the refrain's anchor, and the fallback when a transform can't apply. */
export const PLAIN_STATEMENT: MotifDevelopment = { transform: "statement", step: 0 };

export interface DevelopOptions {
  readonly beatsPerBar: number;
  /** Bars the source motif spans. */
  readonly motifBars: number;
  /** Bars available in the section — a transform may not outgrow its section. */
  readonly sectionBars: number;
  /** Melody-degree range `[low, high]` the result must fit. */
  readonly range: readonly [number, number];
  /** Degrees per octave (the raga's size) — the unit of a shape-preserving shift. */
  readonly degreesPerOctave: number;
  /** Max jump between consecutive notes, in degrees. */
  readonly maxLeap: number;
}

/** A developed theme, and the bars it now spans — augmentation broadens it. */
export interface DevelopedMotif {
  readonly notes: readonly MelodyNote[];
  readonly bars: number;
}

/**
 * Apply a {@link MotifDevelopment} to the theme. The result keeps the motif's
 * ordering and never overlaps itself, stays inside `range`, and honours the
 * melody's leap cap — a development the line could not have sung is not one.
 *
 * A transform that cannot apply musically yields to the plain statement: an
 * unrecognisable "development" is worse than an honest repeat.
 */
export function developMotif(
  motif: readonly MelodyNote[],
  development: MotifDevelopment,
  o: DevelopOptions,
): DevelopedMotif {
  const plain: DevelopedMotif = { notes: motif, bars: o.motifBars };
  if (motif.length === 0) return plain;

  const developed = apply(motif, development, o);
  if (!developed) return plain;
  const notes = fitRange(developed.notes, o);
  return exceedsLeap(notes, o.maxLeap) ? plain : { notes, bars: developed.bars };
}

/** A position's metric weight is read within its own bar, so later bars accent like the first. */
const isStrong = (startBeat: number, beatsPerBar: number) =>
  metricStrength(startBeat % beatsPerBar, beatsPerBar) >= STRONG_THRESHOLD;

/** Build the transformed theme, or `null` when the device doesn't fit this section. */
function apply(
  motif: readonly MelodyNote[],
  { transform, step }: MotifDevelopment,
  o: DevelopOptions,
): DevelopedMotif | null {
  switch (transform) {
    case "statement":
      return { notes: motif, bars: o.motifBars };

    case "sequence":
      // The same shape restarted a step away. Intervals survive intact, so the ear
      // hears "that phrase again, higher" — the plainest development there is.
      return { notes: motif.map((n) => ({ ...n, degree: n.degree + step })), bars: o.motifBars };

    case "inversion": {
      // Mirror the contour about the opening degree: every rise becomes an equal fall.
      // Mirroring in DEGREES rather than semitones is what keeps the answer in the raga.
      const pivot = motif[0]!.degree;
      return {
        notes: motif.map((n) => ({ ...n, degree: 2 * pivot - n.degree })),
        bars: o.motifBars,
      };
    }

    case "augmentation": {
      // Twice the note values — the theme broadened. It has to leave the section room
      // to carry on past it, or the section becomes nothing but the theme.
      const bars = o.motifBars * 2;
      if (bars >= o.sectionBars) return null;
      return {
        notes: motif.map((n) => {
          const startBeat = n.startBeat * 2;
          // The note lands elsewhere in the bar now, so its metric weight — and with it
          // the chord-tone snapping downstream — has to be re-read.
          return {
            ...n,
            startBeat,
            durationBeats: n.durationBeats * 2,
            strong: isStrong(startBeat, o.beatsPerBar),
          };
        }),
        bars,
      };
    }

    case "fragmentation": {
      // Keep only the head and say it again, lifted: the theme broken down and insisted
      // on. Repeats sit a whole bar apart, so each one keeps the original's metric weight.
      const head = motif.filter((n) => n.startBeat < o.beatsPerBar);
      if (head.length === 0) return null;
      const notes: MelodyNote[] = [];
      for (let repeat = 0; repeat < o.motifBars; repeat++) {
        for (const n of head) {
          notes.push({
            ...n,
            startBeat: n.startBeat + repeat * o.beatsPerBar,
            // A head note may be sustained past the bar line; trim it so the next
            // repeat can start where it should instead of sounding over it.
            durationBeats: Math.min(n.durationBeats, o.beatsPerBar - n.startBeat),
            degree: n.degree + repeat * step,
          });
        }
      }
      return { notes, bars: o.motifBars };
    }
  }
}

/**
 * Move the theme into `range` by WHOLE OCTAVES — the only transposition that
 * relocates it without touching its shape or its pitch classes. Clamping is the
 * last resort, for a theme wider than the range itself.
 */
function fitRange(notes: readonly MelodyNote[], o: DevelopOptions): readonly MelodyNote[] {
  const [lo, hi] = o.range;
  let min = Infinity;
  let max = -Infinity;
  for (const n of notes) {
    if (n.degree < min) min = n.degree;
    if (n.degree > max) max = n.degree;
  }
  if (min >= lo && max <= hi) return notes;

  const octave = Math.max(1, o.degreesPerOctave);
  const shift =
    max > hi ? -Math.ceil((max - hi) / octave) * octave : Math.ceil((lo - min) / octave) * octave;
  return notes.map((n) => ({ ...n, degree: clamp(n.degree + shift, lo, hi) }));
}

function exceedsLeap(notes: readonly MelodyNote[], maxLeap: number): boolean {
  for (let i = 1; i < notes.length; i++) {
    if (Math.abs(notes[i]!.degree - notes[i - 1]!.degree) > maxLeap) return true;
  }
  return false;
}
