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
  /**
   * A second chord taking over at the bar's midpoint, when the harmony moves twice as
   * fast for a bar. Absent on the great majority of bars — one chord per bar is the
   * rule and this is the exception that makes an approach to a cadence feel like one.
   * Read it through {@link chordAt}; a voice that ignores it will sound against the
   * bar's second half.
   */
  readonly second?: { readonly degree: number; readonly chord: Chord };
}

/**
 * The chord sounding at `beatInBar`. The midpoint is floored to a beat so it lands on
 * the grid in every meter, matching where the bass already divides its bar.
 */
export function chordAt(bar: HarmonicBar, beatInBar: number, beatsPerBar: number): Chord {
  return bar.second && beatInBar >= Math.floor(beatsPerBar / 2) ? bar.second.chord : bar.chord;
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
  /**
   * Scale degrees (0..6) voiced with their diatonic seventh — harmonic colour. A
   * diatonic seventh is always in key, and its quality (maj7 / min7 / dom7) falls out
   * of the scale. The final tonic resolution stays a plain triad regardless, so the
   * loop still lands. Default: none (all triads).
   */
  sevenths?: readonly number[];
}

const DEFAULT_BARS = 8;
const DEFAULT_BEATS_PER_BAR = 4;

/** Chance a borrow-eligible plan actually swaps in one borrowed chord. */
/** How often the approach to a cadence divides into two chords. */
const SPLIT_RATE = 0.4;

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

  // Cadence: the final bar always resolves to the tonic (the seamless loop point) and
  // the midpoint stays an open V "question"; the APPROACH to the resolution varies.
  const final = bars - 1;
  const half = Math.floor(bars / 2) - 1;
  degrees[final] = 0; // I — the resolution / loop point
  degrees[half] = 4; // V — the open half-cadence
  const cadence = rng.pick(["authentic", "plagal", "iiV"] as const);
  if (cadence === "plagal") {
    degrees[final - 1] = 3; // IV→I — a gentle plagal "amen"
  } else if (cadence === "iiV" && final - 2 > half) {
    degrees[final - 2] = 1; // ii
    degrees[final - 1] = 4; // V — a fuller ii–V–I
  } else {
    degrees[final - 1] = 4; // V→I — the authentic cadence
  }

  // Voice a degree with its diatonic seventh when the style asks — except the final
  // resolution, which stays a triad so the loop lands cleanly on a plain tonic.
  const seventhDegrees = new Set(options.sevenths ?? []);
  const chordFor = (degree: number, isFinalResolution: boolean): Chord =>
    diatonicChord(scale, degree, !isFinalResolution && seventhDegrees.has(degree) ? 4 : 3);

  const barsOut: HarmonicBar[] = degrees.map((degree, i) => ({
    degree,
    chord: chordFor(degree, i === final),
  }));

  // Harmonic rhythm: the approach to a cadence may move twice as fast, compressing
  // ii-V into the bar before the resolution. One chord per bar everywhere else — a
  // piece that changed chords constantly would read as restless, not as arriving.
  // (Roll always consumed, so the seed stream doesn't shift with the meter.)
  const splitApproach = rng.next() < SPLIT_RATE;
  if (splitApproach && cadence !== "iiV" && beatsPerBar % 2 === 0 && final - 1 > half) {
    const approach = final - 1;
    barsOut[approach] = {
      degree: 1, // ii for the first half…
      chord: chordFor(1, false),
      second: { degree: 4, chord: chordFor(4, false) }, // …V for the second
    };
  }

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
