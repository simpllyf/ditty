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
 */
import { type ScoreVoice } from "./voices";
import { type InstrumentName, instrumentsForVoice } from "./instruments";
import type { Rng } from "./rng";
import type { DrumGrooveName } from "./theory/rhythm";
import { SCALES, type Scale } from "./theory/scales";

/** A parent-scale + raga pairing a style may draw on (raga ⊆ parent). */
export interface ScaleKey {
  readonly parent: Scale;
  readonly raga: Scale;
}

export interface Style {
  readonly name: string;
  readonly keys: readonly ScaleKey[];
  readonly grooves: readonly DrumGrooveName[];
  readonly bpm: readonly [number, number]; // integer, inclusive
  readonly swing: readonly [number, number];
  readonly density: readonly [number, number];
  readonly rootMidi: readonly [number, number]; // integer, inclusive, ⊆ [36, 84]
  /** Optional per-voice instrument shortlists; an unset voice uses all suitable instruments. */
  readonly instruments?: Partial<Record<ScoreVoice, readonly InstrumentName[]>>;
}

/** Concrete values chosen from a style, ready for the engine. */
export interface ChosenStyle {
  readonly parent: Scale;
  readonly raga: Scale;
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
      { parent: SCALES.lydian, raga: SCALES.majorPentatonic },
      { parent: SCALES.major, raga: SCALES.majorPentatonic },
    ],
    grooves: ["straight", "fourOnFloor", "busy", "syncopated"],
    bpm: [104, 132],
    swing: [0, 0.3],
    density: [0.5, 0.8],
    rootMidi: [57, 64],
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
      { parent: SCALES.dorian, raga: SCALES.minorPentatonic },
    ],
    grooves: ["soft", "halfTime"],
    bpm: [68, 92],
    swing: [0, 0.4],
    density: [0.2, 0.5],
    rootMidi: [55, 62],
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
      { parent: SCALES.major, raga: SCALES.majorPentatonic },
      { parent: SCALES.mayamalavagowla, raga: SCALES.mayamalavagowla }, // exotic spice
    ],
    grooves: ["fourOnFloor", "busy", "straight", "syncopated", "breakbeat", "halfDouble"],
    bpm: [112, 140],
    swing: [0.1, 0.4],
    density: [0.6, 0.9],
    rootMidi: [57, 64],
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
      { parent: SCALES.lydian, raga: SCALES.majorPentatonic }, // floaty
      { parent: SCALES.harmonicMinor, raga: SCALES.harmonicMinor }, // dramatic
      { parent: SCALES.phrygian, raga: SCALES.minorPentatonic }, // dark
      { parent: SCALES.melodicMinor, raga: SCALES.abhogi },
    ],
    grooves: ["soft", "halfTime", "straight"],
    bpm: [72, 100],
    swing: [0, 0.3],
    density: [0.3, 0.6],
    rootMidi: [55, 62],
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
    ],
    grooves: ["halfTime", "soft", "breakbeat"],
    bpm: [68, 88],
    swing: [0.2, 0.5], // dusty shuffle
    density: [0.3, 0.55],
    rootMidi: [55, 62],
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
      { parent: SCALES.harmonicMinor, raga: SCALES.harmonicMinor }, // dramatic
      { parent: SCALES.naturalMinor, raga: SCALES.hindolam },
      { parent: SCALES.lydian, raga: SCALES.kalyani }, // bright/epic
      { parent: SCALES.phrygian, raga: SCALES.minorPentatonic }, // dark
      { parent: SCALES.melodicMinor, raga: SCALES.abhogi },
    ],
    grooves: ["halfTime", "straight", "soft"],
    bpm: [70, 100],
    swing: [0, 0.2],
    density: [0.35, 0.65],
    rootMidi: [52, 60], // weighty, lower register
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
      { parent: SCALES.lydian, raga: SCALES.majorPentatonic }, // floaty
      { parent: SCALES.major, raga: SCALES.shuddhaSaveri },
      { parent: SCALES.dorian, raga: SCALES.abhogi },
      { parent: SCALES.lydian, raga: SCALES.kalyani },
      { parent: SCALES.mixolydian, raga: SCALES.madhyamavati },
    ],
    grooves: ["soft", "halfTime", "none"], // often drumless
    bpm: [56, 76],
    swing: [0, 0.2],
    density: [0.15, 0.4], // sparse, floating
    rootMidi: [55, 64],
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
    rootMidi,
    groove,
    bpm,
    swing,
    density,
    instruments: resolvePools(style.instruments),
  };
}
