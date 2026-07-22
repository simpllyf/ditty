/**
 * Styles — curated "vibes" the randomizer draws from. A {@link Style} is a pool of
 * musical parameters (valid scale pairings, grooves, tempo/feel ranges, instrument
 * shortlists); {@link pickStyle} turns it into one concrete choice per seed. Pure
 * data + a pure picker — the engine fills any unset option from the chosen style.
 *
 * Each `keys` entry pairs a harmony parent with a melody raga that is a pitch-class
 * SUBSET of it, so the lead always stays in key. Several pairings are load-bearing:
 * madhyamavati needs mixolydian (b7), hindolam needs naturalMinor (b6), abhogi
 * needs dorian (natural 6) — do not "simplify" these to a major parent.
 *
 * A pairing may also carry `paths` (arohana/avarohana). Those ragas are defined by
 * the way they move, not by their note set — drop the paths and bilahari is just
 * major — so the two always travel together.
 */
import { type ScoreVoice } from "./voices";
import { type InstrumentName, instrumentsForVoice } from "./instruments";
import type { Rng } from "./rng";
import type { DrumGrooveName } from "./theory/rhythm";
import { RAGA_PATHS, type RagaPaths, SCALES, type Scale } from "./theory/scales";

/** A parent-scale + raga pairing a style may draw on (raga ⊆ parent). */
export interface ScaleKey {
  readonly parent: Scale;
  readonly raga: Scale;
  /** Arohana/avarohana, for a raga that moves differently up and down. */
  readonly paths?: RagaPaths;
  /**
   * Whether the melody scale is a raga that carries kampita (the sung shake between
   * swaras). Default true; set false for a plain Western scale used as the melody —
   * a major/minor pentatonic or harmonic minor has no swaras to oscillate toward, and
   * shaking it borrows a Carnatic device it isn't. It cannot be read from the notes:
   * `majorPentatonic` and `mohanam` are the same array and only the pairing knows which
   * one is meant. (The slide is portamento, universal in music, so it is not gated.)
   */
  readonly carnatic?: boolean;
}

export interface Style {
  readonly name: string;
  readonly keys: readonly ScaleKey[];
  readonly grooves: readonly DrumGrooveName[];
  readonly bpm: readonly [number, number]; // integer, inclusive
  readonly swing: readonly [number, number];
  readonly density: readonly [number, number];
  readonly rootMidi: readonly [number, number]; // integer, inclusive, ⊆ [36, 84]
  /**
   * Scale degrees (0..6) voiced with their diatonic seventh — the style's harmonic
   * colour. Lush styles voice most chords as sevenths; bright ones stay near-triadic.
   * Omit for all triads.
   */
  readonly sevenths?: readonly number[];
  /** Optional per-voice instrument shortlists; an unset voice uses all suitable instruments. */
  readonly instruments?: Partial<Record<ScoreVoice, readonly InstrumentName[]>>;
}

/** Concrete values chosen from a style, ready for the engine. */
export interface ChosenStyle {
  readonly parent: Scale;
  readonly raga: Scale;
  readonly paths?: RagaPaths;
  /** Whether the melody scale carries kampita — see {@link ScaleKey.carnatic}. */
  readonly carnatic?: boolean;
  /** Scale degrees voiced with their diatonic seventh — the style's harmonic colour. */
  readonly sevenths?: readonly number[];
  readonly rootMidi: number;
  readonly groove: DrumGrooveName;
  readonly bpm: number;
  readonly swing: number;
  readonly density: number;
  readonly instruments: Record<ScoreVoice, readonly InstrumentName[]>;
}

export const STYLES = {
  peppy: {
    name: "peppy",
    keys: [
      { parent: SCALES.major, raga: SCALES.mohanam },
      { parent: SCALES.major, raga: SCALES.hamsadhwani },
      { parent: SCALES.major, raga: SCALES.shuddhaSaveri },
      { parent: SCALES.mixolydian, raga: SCALES.madhyamavati },
      { parent: SCALES.lydian, raga: SCALES.kalyani }, // bright, floaty (#4)
      { parent: SCALES.lydian, raga: SCALES.majorPentatonic, carnatic: false },
      { parent: SCALES.major, raga: SCALES.majorPentatonic, carnatic: false },
      { parent: SCALES.major, raga: SCALES.bilahari, paths: RAGA_PATHS.bilahari }, // climbs bright, comes down full
    ],
    grooves: ["straight", "fourOnFloor", "busy", "syncopated"],
    bpm: [104, 132],
    swing: [0, 0.3],
    density: [0.5, 0.8],
    rootMidi: [57, 64],
    sevenths: [4], // V7 only — a touch of pull, stays bright
    instruments: {
      lead: ["pluck", "marimba", "squareLead", "synthBrass", "supersaw"],
      pad: ["warmPad", "glassPad", "organ", "strings", "supersaw"],
      arp: ["pluck", "bell", "musicBox", "glockenspiel", "celesta", "harp"],
      bass: ["subBass", "roundBass"],
    },
  },
  calm: {
    name: "calm",
    keys: [
      { parent: SCALES.naturalMinor, raga: SCALES.hindolam },
      { parent: SCALES.dorian, raga: SCALES.abhogi },
      { parent: SCALES.major, raga: SCALES.mohanam },
      { parent: SCALES.phrygian, raga: SCALES.hindolam }, // dark, gentle
      { parent: SCALES.melodicMinor, raga: SCALES.abhogi }, // wistful
      { parent: SCALES.dorian, raga: SCALES.minorPentatonic, carnatic: false },
      { parent: SCALES.dorian, raga: SCALES.sriranjani }, // wistful, fifth-less
      { parent: SCALES.mixolydian, raga: SCALES.kambhoji, paths: RAGA_PATHS.kambhoji }, // warm, the b7 only on the way down
    ],
    grooves: ["soft", "halfTime", "waltz"],
    bpm: [68, 92],
    swing: [0, 0.4],
    density: [0.2, 0.5],
    rootMidi: [55, 62],
    sevenths: [1, 4, 5], // ii7 · V7 · vi7 — gently warm
    instruments: {
      lead: ["sineLead", "marimba", "epiano", "airLead", "clarinet", "strings", "harp"],
      pad: ["warmPad", "glassPad", "epiano", "strings", "tubularBell", "choir"],
      arp: ["musicBox", "bell", "glockenspiel", "celesta", "harp", "tubularBell"],
      bass: ["subBass", "roundBass"],
    },
  },
  playful: {
    name: "playful",
    keys: [
      { parent: SCALES.major, raga: SCALES.hamsadhwani },
      { parent: SCALES.mixolydian, raga: SCALES.madhyamavati },
      { parent: SCALES.major, raga: SCALES.mohanam },
      { parent: SCALES.lydian, raga: SCALES.kalyani },
      { parent: SCALES.major, raga: SCALES.majorPentatonic, carnatic: false },
      { parent: SCALES.mayamalavagowla, raga: SCALES.mayamalavagowla }, // exotic spice
      { parent: SCALES.major, raga: SCALES.arabhi, paths: RAGA_PATHS.arabhi }, // bold ascent, full descent
    ],
    grooves: [
      "fourOnFloor",
      "busy",
      "straight",
      "syncopated",
      "breakbeat",
      "halfDouble",
      "sixEight",
    ],
    bpm: [112, 140],
    swing: [0.1, 0.4],
    density: [0.6, 0.9],
    rootMidi: [57, 64],
    sevenths: [4], // V7 only — bright and simple
    instruments: {
      lead: ["squareLead", "pluck", "synthArp", "synthBrass", "supersaw"],
      pad: ["organ", "glassPad", "strings", "supersaw"],
      arp: ["synthArp", "pluck", "musicBox", "glockenspiel", "celesta", "harp"],
      bass: ["roundBass", "subBass"],
    },
  },
  dreamy: {
    name: "dreamy",
    keys: [
      { parent: SCALES.major, raga: SCALES.shuddhaSaveri },
      { parent: SCALES.dorian, raga: SCALES.abhogi },
      { parent: SCALES.naturalMinor, raga: SCALES.hindolam },
      { parent: SCALES.lydian, raga: SCALES.majorPentatonic, carnatic: false }, // floaty
      { parent: SCALES.harmonicMinor, raga: SCALES.harmonicMinor, carnatic: false }, // dramatic
      { parent: SCALES.phrygian, raga: SCALES.minorPentatonic, carnatic: false }, // dark
      { parent: SCALES.melodicMinor, raga: SCALES.abhogi },
      { parent: SCALES.dorian, raga: SCALES.sriranjani },
      {
        parent: SCALES.lydian,
        raga: SCALES.mohanakalyani,
        paths: RAGA_PATHS.mohanakalyani, // pentatonic up, the #4 waiting on the way down
      },
    ],
    grooves: ["soft", "halfTime", "straight", "waltz", "sixEight"],
    bpm: [72, 100],
    swing: [0, 0.3],
    density: [0.3, 0.6],
    rootMidi: [55, 62],
    sevenths: [0, 1, 3, 4, 5], // lush: maj7 tonic and sevenths throughout
    instruments: {
      lead: ["sineLead", "marimba", "epiano", "airLead", "clarinet", "strings", "harp"],
      pad: ["glassPad", "warmPad", "epiano", "strings", "tubularBell", "choir"],
      arp: ["bell", "musicBox", "glockenspiel", "celesta", "harp", "tubularBell"],
      bass: ["subBass", "roundBass"],
    },
  },
  lofi: {
    name: "lofi",
    keys: [
      { parent: SCALES.dorian, raga: SCALES.abhogi },
      { parent: SCALES.naturalMinor, raga: SCALES.hindolam },
      { parent: SCALES.major, raga: SCALES.mohanam },
      { parent: SCALES.melodicMinor, raga: SCALES.abhogi },
      { parent: SCALES.charukesi, raga: SCALES.charukesi },
    ],
    grooves: ["halfTime", "soft", "breakbeat"],
    bpm: [68, 88],
    swing: [0.2, 0.5], // dusty shuffle
    density: [0.3, 0.55],
    rootMidi: [55, 62],
    sevenths: [0, 1, 2, 3, 4, 5, 6], // sevenths on everything — the lofi signature
    instruments: {
      lead: ["epiano", "sineLead", "marimba", "clarinet"],
      pad: ["warmPad", "epiano", "choir", "glassPad"],
      arp: ["musicBox", "bell", "harp", "celesta"],
      bass: ["roundBass", "subBass"],
    },
  },
  cinematic: {
    name: "cinematic",
    keys: [
      { parent: SCALES.harmonicMinor, raga: SCALES.harmonicMinor, carnatic: false }, // dramatic
      { parent: SCALES.naturalMinor, raga: SCALES.hindolam },
      { parent: SCALES.lydian, raga: SCALES.kalyani }, // bright/epic
      { parent: SCALES.phrygian, raga: SCALES.minorPentatonic, carnatic: false }, // dark
      { parent: SCALES.melodicMinor, raga: SCALES.abhogi },
      { parent: SCALES.phrygian, raga: SCALES.revati },
      { parent: SCALES.charukesi, raga: SCALES.charukesi }, // bittersweet
    ],
    grooves: ["halfTime", "straight", "soft", "sixEight"],
    bpm: [70, 100],
    swing: [0, 0.2],
    density: [0.35, 0.65],
    rootMidi: [52, 60], // weighty, lower register
    sevenths: [1, 3, 4, 5], // rich, but a clean triad tonic for gravitas
    instruments: {
      lead: ["strings", "airLead", "choir", "sineLead"],
      pad: ["strings", "choir", "warmPad", "glassPad"],
      arp: ["harp", "glockenspiel", "celesta", "tubularBell"],
      bass: ["subBass", "roundBass"],
    },
  },
  ambient: {
    name: "ambient",
    keys: [
      { parent: SCALES.lydian, raga: SCALES.majorPentatonic, carnatic: false }, // floaty
      { parent: SCALES.major, raga: SCALES.shuddhaSaveri },
      { parent: SCALES.dorian, raga: SCALES.abhogi },
      { parent: SCALES.lydian, raga: SCALES.kalyani },
      { parent: SCALES.mixolydian, raga: SCALES.madhyamavati },
      { parent: SCALES.phrygian, raga: SCALES.revati }, // serene, exotic
    ],
    grooves: ["soft", "halfTime", "none", "waltz", "sixEight"], // often drumless
    bpm: [56, 76],
    swing: [0, 0.2],
    density: [0.15, 0.4], // sparse, floating
    rootMidi: [55, 64],
    sevenths: [0, 1, 3, 4, 5], // floaty maj7 colour
    instruments: {
      lead: ["airLead", "choir", "sineLead", "strings"],
      pad: ["warmPad", "glassPad", "choir", "strings", "tubularBell"],
      arp: ["bell", "musicBox", "celesta", "glockenspiel", "harp"],
      bass: ["subBass"],
    },
  },
} as const satisfies Record<string, Style>;

export type StyleName = keyof typeof STYLES;

const VOICES: readonly ScoreVoice[] = ["lead", "bass", "pad", "arp"];

const rangeInt = (rng: Rng, [lo, hi]: readonly [number, number]) => lo + rng.int(hi - lo + 1);
const rangeFloat = (rng: Rng, [lo, hi]: readonly [number, number]) => lo + rng.next() * (hi - lo);

/** Resolve a style's instrument shortlists to valid, non-empty pools per voice. */
function resolvePools(
  shortlists: Style["instruments"],
): Record<ScoreVoice, readonly InstrumentName[]> {
  const out = {} as Record<ScoreVoice, readonly InstrumentName[]>;
  for (const voice of VOICES) {
    const suitable = instrumentsForVoice(voice);
    const listed = shortlists?.[voice];
    const filtered = listed?.filter((name) => suitable.includes(name));
    out[voice] = filtered && filtered.length > 0 ? filtered : suitable;
  }
  return out;
}

/** Pick one concrete configuration from a style. Deterministic; consumes `rng` directly. */
export function pickStyle(rng: Rng, name: StyleName = "peppy"): ChosenStyle {
  if (!(name in STYLES)) {
    throw new RangeError(`pickStyle: unknown style "${name}"`);
  }
  const style: Style = STYLES[name]; // widen the `as const` literal so pick/range typecheck
  const key = rng.pick(style.keys);
  const groove = rng.pick(style.grooves);
  const rootMidi = rangeInt(rng, style.rootMidi);
  const bpm = rangeInt(rng, style.bpm);
  const swing = rangeFloat(rng, style.swing);
  const density = rangeFloat(rng, style.density);
  return {
    parent: key.parent,
    raga: key.raga,
    ...(key.paths !== undefined ? { paths: key.paths } : {}),
    ...(key.carnatic !== undefined ? { carnatic: key.carnatic } : {}),
    ...(style.sevenths !== undefined ? { sevenths: style.sevenths } : {}),
    rootMidi,
    groove,
    bpm,
    swing,
    density,
    instruments: resolvePools(style.instruments),
  };
}
