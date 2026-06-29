/**
 * Harmony plan — lays a chord progression across bars with cadences and a clean
 * loop. The coherence backbone: the melody and arranger read this.
 *
 * Pure (rng + theory), deterministic. **Consumes the passed `rng` directly** —
 * the arranger forks a dedicated stream per concern (harmony vs melody vs …) so
 * adding a draw in one doesn't shift another.
 *
 * Harmony is always built on a heptatonic **parent** key. When the melody uses a
 * pentatonic raga, the arranger picks a parent (e.g. mohanam → major); this layer
 * requires a 7-note scale and rejects anything else.
 */
import type { Rng } from "../rng";
import { type Chord, type ChordQuality, diatonicChord, makeChord } from "../theory/chords";
import { PROGRESSIONS, functionalProgression } from "../theory/progressions";
import { DEFAULT_ROOT_MIDI, pitchClass } from "../theory/pitch";
import { SCALES, type Scale } from "../theory/scales";

/** One bar of harmony: the chosen degree root and its triad (size-3 convenience). */
export interface HarmonicBar {
  /**
   * 0-based scale degree the bar was built from. Identifies the chord for diatonic
   * bars; a borrowed (modal-interchange) bar keeps its original degree but its
   * `chord` is non-diatonic — read `chord` directly, don't recompute from `degree`.
   */
  readonly degree: number;
  /** The bar's triad (pitch classes) — diatonic on `degree`, or a borrowed chord. */
  readonly chord: Chord;
}

/** A bar-by-bar harmonic plan over a heptatonic parent key. */
export interface HarmonicPlan {
  readonly scale: Scale;
  readonly rootMidi: number;
  readonly beatsPerBar: number;
  readonly bars: readonly HarmonicBar[];
  /** Bar indices of the half-cadence (open "question") and the final tonic resolution. */
  readonly cadences: { readonly half: number; readonly final: number };
}

export interface HarmonyOptions {
  /** Seeded PRNG (consumed directly). */
  rng: Rng;
  /** Heptatonic parent key for chords. Default: major. */
  scale?: Scale;
  /** MIDI note of the tonic. Default 60. */
  rootMidi?: number;
  /** Number of bars (>= 4). Default 8. */
  bars?: number;
  /** Beats per bar (>= 1). Default 4. */
  beatsPerBar?: number;
  /** Explicit degree roots (0..6), tiled across bars. Overrides the choice. */
  progression?: readonly number[];
  /** Use the functional generator instead of a library progression. */
  generate?: boolean;
  /** Allow an occasional borrowed (non-diatonic) chord — only over bright-major keys. */
  borrow?: boolean;
}

const DEFAULT_BARS = 8;
const DEFAULT_BEATS_PER_BAR = 4;

/** Chance a borrow-eligible plan actually swaps in one borrowed chord. */
const BORROW_RATE = 0.4;
/**
 * Borrowed chords (modal interchange), relative to the tonic. Each shares a tone
 * with the tonic and with any in-key raga, so the melody still lands consonantly.
 */
const BORROWED_CHORDS: ReadonlyArray<{ shift: number; quality: ChordQuality }> = [
  { shift: 10, quality: "major" }, // ♭VII
  { shift: 8, quality: "major" }, // ♭VI
  { shift: 5, quality: "minor" }, // iv
];

/** A bright-major key (major / lydian / mixolydian) — where these borrowings are idiomatic. */
function isBrightMajor(scale: Scale): boolean {
  const pcs = new Set(scale.map(pitchClass));
  return pcs.has(4) && pcs.has(7) && !pcs.has(1) && !pcs.has(3);
}

/** Build a {@link HarmonicPlan}. */
export function generateHarmony(options: HarmonyOptions): HarmonicPlan {
  const { rng } = options;
  const scale = options.scale ?? SCALES.major;
  const rootMidi = options.rootMidi ?? DEFAULT_ROOT_MIDI;
  const bars = options.bars ?? DEFAULT_BARS;
  const beatsPerBar = options.beatsPerBar ?? DEFAULT_BEATS_PER_BAR;

  if (scale.length !== 7) {
    throw new RangeError(
      `generateHarmony requires a 7-note (heptatonic) parent scale, got length ${scale.length}`,
    );
  }
  if (!Number.isInteger(bars) || bars < 4) {
    throw new RangeError(`generateHarmony bars must be an integer >= 4, got ${bars}`);
  }
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1) {
    throw new RangeError(`generateHarmony beatsPerBar must be an integer >= 1, got ${beatsPerBar}`);
  }
  if (!Number.isInteger(rootMidi)) {
    throw new RangeError(`generateHarmony rootMidi must be an integer, got ${rootMidi}`);
  }

  let degrees: number[];
  if (options.progression) {
    const base = options.progression;
    if (base.length === 0) {
      throw new RangeError("generateHarmony progression must be non-empty");
    }
    for (const d of base) {
      if (!Number.isInteger(d) || d < 0 || d > 6) {
        throw new RangeError(`generateHarmony progression degrees must be 0..6, got ${d}`);
      }
    }
    degrees = Array.from({ length: bars }, (_, i) => base[i % base.length] as number);
  } else if (options.generate) {
    degrees = functionalProgression(rng, bars);
  } else {
    const base = rng.pick(Object.values(PROGRESSIONS));
    degrees = Array.from({ length: bars }, (_, i) => base[i % base.length] as number);
  }

  // Cadences: authentic V→I into the loop point, half-cadence on V at the midpoint.
  const final = bars - 1;
  const half = Math.floor(bars / 2) - 1;
  degrees[final] = 0; // I
  degrees[final - 1] = 4; // V
  degrees[half] = 4; // V (open)

  const barsOut: HarmonicBar[] = degrees.map((degree) => ({
    degree,
    chord: diatonicChord(scale, degree),
  }));

  // Modal interchange: occasionally swap one non-cadence bar for a borrowed chord —
  // colour without losing the key. Bright-major only, and never on the tonic anchor
  // or the cadence bars, so the loop still resolves cleanly. (Roll always consumed.)
  if (options.borrow && isBrightMajor(scale) && rng.next() < BORROW_RATE) {
    const eligible = barsOut
      .map((_, i) => i)
      .filter((i) => i !== 0 && i !== half && i !== final && i !== final - 1);
    if (eligible.length > 0) {
      const i = rng.pick(eligible);
      const borrowed = rng.pick(BORROWED_CHORDS);
      // pcs are tonic-relative (0 = tonic), so the shift IS the root — exactly like
      // diatonicChord's degree offsets and the bass `rootMidi + pc` playback.
      barsOut[i] = {
        degree: barsOut[i]!.degree,
        chord: makeChord(borrowed.shift, borrowed.quality),
      };
    }
  }

  return { scale, rootMidi, beatsPerBar, bars: barsOut, cadences: { half, final } };
}

/** The raga pitch classes that coincide with a bar's chord — handy for melody. */
export function chordTonesInScale(chord: Chord, melodyScale: Scale): number[] {
  const ragaPcs = new Set(melodyScale.map(pitchClass));
  return chord.pcs.filter((pc) => ragaPcs.has(pc));
}
