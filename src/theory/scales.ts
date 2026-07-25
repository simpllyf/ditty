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
  // A raga's identity is not in its note set: as sets, kalyani IS lydian and bilahari IS
  // major. What tells them apart is how the line MOVES — the arohana/avarohana it climbs and
  // descends by, where it rests, and which swaras carry gamaka. So a raga earns a name here
  // only when something downstream makes it move differently: a style pairing that marks it
  // `carnatic` (and so oscillates it), or its own `paths`. A name that merely re-labels a
  // Western mode promises a raga and delivers the mode.
  mohanam: [0, 2, 4, 7, 9], // = major pentatonic
  hamsadhwani: [0, 2, 4, 7, 11],
  kalyani: [0, 2, 4, 6, 7, 9, 11], // = lydian
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

/**
 * Which swaras a raga oscillates (kampita), as pitch classes from Sa.
 *
 * This is per-raga knowledge, not a rule that falls out of the intervals: two ragas can share
 * a note and ornament it differently, and a swara left deliberately plain is often the one that
 * identifies the raga. Sa and Pa are excluded everywhere — they are the fixed reference the
 * oscillation moves against — so they never appear here.
 *
 * A raga ABSENT from this table is not "ornament nothing": it means we have no source for it,
 * and it falls back to oscillating every held non-Sa/Pa swara. Only add an entry backed by a
 * source, and prefer omitting one to guessing.
 */
export const RAGA_KAMPITA = {
  mohanam: [2, 4, 9], // Ri, Ga, Da
  abhogi: [3, 9], // Ga, Da — Ri and Ma stay plain
  hindolam: [3, 8, 10], // Ga, Da, Ni — Ma stays plain
  sriranjani: [3, 10], // Ga, Ni only
  kalyani: [2, 4, 6, 9, 11], // every moving swara — the one raga where that is right
} as const satisfies Partial<Record<ScaleName, readonly number[]>>;

/**
 * The swaras this raga oscillates, or null when we have no source and every moving swara is
 * fair game. Null is deliberately distinct from an empty list.
 */
export function kampitaSwaras(raga: ScaleName): readonly number[] | null {
  return (RAGA_KAMPITA as Partial<Record<ScaleName, readonly number[]>>)[raga] ?? null;
}

/** The panchama — the fifth, the tanpura's second pitch and the raga's other fixed note. */
const PANCHAMA = 7;

/**
 * The drone a raga is sung against, as pitch classes from Sa. Sa+Pa, except for a
 * **panchama-varjya** raga (one with no fifth — hindolam, abhogi, sriranjani): there the
 * tanpura's Pa string is retuned to Sa, because a drone sounding a note the raga itself
 * omits contradicts the melody sitting over it.
 *
 * The single place this is decided — the harmony and the tanpura both read it, and a drone
 * whose two voices disagreed would beat against itself.
 */
export function droneTones(raga: Scale): readonly number[] {
  return raga.some((s) => pitchClass(s) === PANCHAMA) ? [0, PANCHAMA] : [0];
}
