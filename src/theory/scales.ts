/**
 * Scales — a broad library of the building blocks, plus degree↔pitch helpers.
 *
 * A {@link Scale} is the set of semitone offsets within one octave, ascending
 * from the tonic at `0`. Extend the library by adding an entry to {@link SCALES}.
 * All of these are public-domain musical materials (modes, pentatonics, and
 * traditional ragas).
 */
import { DEFAULT_ROOT_MIDI, OCTAVE, pitchClass, semitoneToFrequency } from "./pitch";

/**
 * Semitone offsets within one octave, ascending, starting at the tonic (`0`).
 * A custom `parent`/`raga` must include `0` (the melody opens on the tonic) and
 * use distinct pitch classes.
 */
export type Scale = readonly number[];

/**
 * The scale/raga library. Western modes, pentatonics, and bright Carnatic ragas
 * (several of which coincide with a Western mode — noted inline).
 */
export const SCALES = {
  // --- Western modes ---
  major: [0, 2, 4, 5, 7, 9, 11], // Ionian
  naturalMinor: [0, 2, 3, 5, 7, 8, 10], // Aeolian
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  // --- pentatonic & other ---
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
  // --- bright Carnatic ragas (some alias a Western mode) ---
  mohanam: [0, 2, 4, 7, 9], // = major pentatonic
  hamsadhwani: [0, 2, 4, 7, 11],
  shankarabharanam: [0, 2, 4, 5, 7, 9, 11], // = major
  kalyani: [0, 2, 4, 6, 7, 9, 11], // = lydian
  kharaharapriya: [0, 2, 3, 5, 7, 9, 10], // = dorian
  hindolam: [0, 3, 5, 8, 10],
  shuddhaSaveri: [0, 2, 5, 7, 9],
  madhyamavati: [0, 2, 5, 7, 10],
  abhogi: [0, 2, 3, 5, 9],
  mayamalavagowla: [0, 1, 4, 5, 7, 8, 11],
  sriranjani: [0, 2, 3, 5, 9, 10], // ⊆ dorian — wistful, drops the fifth
  revati: [0, 1, 5, 7, 10], // ⊆ phrygian — serene b2 pentatonic
  charukesi: [0, 2, 4, 5, 7, 8, 10], // bright tonic with b6 b7 — bittersweet (a self-paired parent)
  // --- ragas defined by their PATH, not their note set (see RAGA_PATHS) ---
  // Each entry is the union of the raga's ascent and descent. Bilahari and arabhi
  // share that union with major; what tells them apart is which notes each one is
  // allowed to use going up versus coming down.
  bilahari: [0, 2, 4, 5, 7, 9, 11],
  arabhi: [0, 2, 4, 5, 7, 9, 11],
  kambhoji: [0, 2, 4, 5, 7, 9, 10], // ⊆ mixolydian (Harikambhoji)
  mohanakalyani: [0, 2, 4, 6, 7, 9, 11], // ⊆ lydian (Mechakalyani)
} as const satisfies Record<string, Scale>;

/**
 * A raga's melodic paths: the notes available while ASCENDING (**arohana**) and
 * while DESCENDING (**avarohana**). Many ragas are not a single note set but a
 * pair of them — bilahari climbs a bright pentatonic and comes down the full
 * seven, which is what makes it bilahari rather than major.
 *
 * These are the "straight" (non-vakra) ragas: their paths are SETS, so the rule is
 * simply which notes a line may touch in each direction. Vakra ragas, whose ascent
 * zigzags through a fixed ordered figure, are a different mechanism and are not
 * modelled here.
 */
export interface RagaPaths {
  readonly up: Scale;
  readonly down: Scale;
}

/**
 * Ragas whose ascent and descent differ. Every entry's `up ∪ down` equals the
 * matching {@link SCALES} entry — the union is the degree space the melody moves
 * in, and these paths say which of its notes each direction may use.
 */
export const RAGA_PATHS = {
  bilahari: { up: [0, 2, 4, 7, 9], down: [0, 2, 4, 5, 7, 9, 11] },
  arabhi: { up: [0, 2, 5, 7, 9], down: [0, 2, 4, 5, 7, 9, 11] },
  kambhoji: { up: [0, 2, 4, 5, 7, 9], down: [0, 2, 4, 5, 7, 9, 10] },
  mohanakalyani: { up: [0, 2, 4, 7, 9], down: [0, 2, 4, 6, 7, 9, 11] },
} as const satisfies Record<string, RagaPaths>;

/** Name of a built-in scale. */
export type ScaleName = keyof typeof SCALES;

/**
 * Map a scale degree to a semitone offset from the tonic. Degrees outside one
 * octave wrap around the scale and shift by a full octave per wrap, in both
 * directions — so `degree` may be any integer (negative descends below the tonic).
 */
export function degreeToSemitone(scale: Scale, degree: number): number {
  if (scale.length === 0) {
    throw new RangeError("degreeToSemitone() requires a non-empty scale");
  }
  if (!Number.isInteger(degree)) {
    throw new RangeError(`degreeToSemitone() requires an integer degree, got ${degree}`);
  }
  const octave = Math.floor(degree / scale.length);
  const index = degree - octave * scale.length;
  return (scale[index] as number) + octave * OCTAVE;
}

/** Convenience: frequency, in Hz, of a scale degree relative to a root MIDI note. */
export function degreeToFrequency(
  scale: Scale,
  degree: number,
  rootMidi: number = DEFAULT_ROOT_MIDI,
): number {
  return semitoneToFrequency(degreeToSemitone(scale, degree), rootMidi);
}

/** Pitch class (0–11) of a scale degree. */
export function degreePitchClass(scale: Scale, degree: number): number {
  return pitchClass(degreeToSemitone(scale, degree));
}
