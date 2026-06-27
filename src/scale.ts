/**
 * Pitch — scales and the maps from a scale degree to a semitone to a frequency.
 *
 * Pure and tiny. A {@link Scale} is the set of semitone offsets within one
 * octave, ascending from the tonic at `0`. Pentatonic is the default for peppy
 * music because it is nearly impossible to make sound wrong.
 */

/** Semitone offsets within one octave, ascending, starting at the tonic (`0`). */
export type Scale = readonly number[];

/** The scales shipped in v1. */
export const SCALES = {
  /** Major pentatonic (1 2 3 5 6) — five notes, the peppy default. */
  majorPentatonic: [0, 2, 4, 7, 9],
  /** Major (Ionian) — the full seven-note diatonic scale. */
  major: [0, 2, 4, 5, 7, 9, 11],
} as const satisfies Record<string, Scale>;

/** Name of a built-in scale. */
export type ScaleName = keyof typeof SCALES;

/** MIDI note number of A4, the equal-temperament reference. */
const A4_MIDI = 69;
/** Frequency of A4 in Hz. */
const A4_HZ = 440;
/** Semitones per octave. */
const OCTAVE = 12;

/**
 * Default root: middle C (MIDI 60, ~261.63 Hz). A bright, neutral key; presets
 * pick the actual register for a given mood.
 */
export const DEFAULT_ROOT_MIDI = 60;

/**
 * Map a scale degree to a semitone offset from the tonic. Degrees outside one
 * octave wrap around the scale and shift by a full octave per wrap, in both
 * directions — so `degree` may be any integer (negative descends below the
 * tonic).
 *
 * @example degreeToSemitone(SCALES.majorPentatonic, 5) === 12 // tonic, one octave up
 */
export function degreeToSemitone(scale: Scale, degree: number): number {
  if (scale.length === 0) {
    throw new RangeError("degreeToSemitone() requires a non-empty scale");
  }
  if (!Number.isInteger(degree)) {
    throw new RangeError(`degreeToSemitone() requires an integer degree, got ${degree}`);
  }
  // Floor division so negative degrees descend correctly into lower octaves.
  const octave = Math.floor(degree / scale.length);
  const index = degree - octave * scale.length; // always within [0, length)
  return (scale[index] as number) + octave * OCTAVE;
}

/**
 * Equal-temperament frequency, in Hz, of a semitone offset from a root MIDI
 * note: `440 * 2^((rootMidi + semitone - 69) / 12)`.
 */
export function semitoneToFrequency(
  semitone: number,
  rootMidi: number = DEFAULT_ROOT_MIDI,
): number {
  return A4_HZ * 2 ** ((rootMidi + semitone - A4_MIDI) / OCTAVE);
}

/** Convenience: frequency, in Hz, of a scale degree relative to a root MIDI note. */
export function degreeToFrequency(
  scale: Scale,
  degree: number,
  rootMidi: number = DEFAULT_ROOT_MIDI,
): number {
  return semitoneToFrequency(degreeToSemitone(scale, degree), rootMidi);
}
