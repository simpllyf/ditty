/**
 * Session — the seed→music brain shared by the realtime engine and the offline
 * renderer. Chooses a style and instruments ONCE, then yields successive Scores
 * (re-arranged each loop when `evolve`, else a cached one). Pure: no Web Audio
 * (the audio layer's `buildLoop` binds these Scores to a synth).
 */
import { type ArrangeOptions, type Score, arrange } from "./compose/arranger";
import {
  DRUM_KITS,
  type DrumVoice,
  INSTRUMENTS,
  type Instrument,
  type InstrumentName,
} from "./instruments";
import { makeNoiseTable } from "./noise";
import { type Rng, makeRng } from "./rng";
import { type StyleName, pickStyle } from "./styles";
import type { DrumName, ScoreVoice } from "./voices";

/** The musical knobs shared by the engine and the renderer; each falls back to the style. */
export interface SessionOptions {
  /** Omit for a fresh random seed each session; set for a reproducible stream. */
  seed?: number;
  /** The vibe to randomize within. Default "peppy". Explicit options below override it. */
  style?: StyleName;
  /** Tempo in beats per minute. Default: from the style. */
  bpm?: number;
  /** Time signature — beats per bar. Default 4. */
  beatsPerBar?: number;
  /** Bars per loop. Default 8. */
  bars?: number;
  /** Harmony parent scale (heptatonic). Overrides the style. */
  parent?: ArrangeOptions["parent"];
  /** Melody raga. Overrides the style — pair with a compatible `parent` (raga ⊆ parent) to stay in key. */
  raga?: ArrangeOptions["raga"];
  /** Tonic MIDI note (integer 36–84). Default: from the style. */
  rootMidi?: number;
  /** Drum groove name. Default: from the style. */
  groove?: ArrangeOptions["groove"];
  /** Melodic note density 0..1 (sparser→busier). Default: from the style. */
  density?: number;
  /** Swing amount 0..1. Default: from the style. */
  swing?: number;
  /** Per-voice toggles, e.g. `{ pad: false, drums: false }`. Default: all on. */
  voices?: ArrangeOptions["voices"];
  /** Re-arrange each loop for endless variety (default true); false reuses one arrangement. */
  evolve?: boolean;
}

export interface Session {
  readonly noiseTable: Float32Array;
  readonly bpm: number;
  readonly beatsPerBar: number;
  readonly bars: number;
  readonly instruments: Record<ScoreVoice, Instrument>;
  readonly drumKit: Record<DrumName, DrumVoice>;
  /** Arrange the next loop (advances the rng), or the cached one when `evolve` is off. */
  nextScore(): Score;
}

/** A 32-bit seed from Web Crypto, falling back to the clock (never Math.random). */
function randomSeed(): number {
  const webCrypto = globalThis.crypto;
  if (webCrypto?.getRandomValues) {
    return webCrypto.getRandomValues(new Uint32Array(1))[0] as number;
  }
  /* c8 ignore next -- only reached in environments without Web Crypto */
  return Date.now() >>> 0;
}

function pickInstrument(rng: Rng, pool: readonly InstrumentName[]): Instrument {
  return INSTRUMENTS[rng.pick(pool)];
}

/** Build the seed→music session. Validates bpm; deterministic for a seed. */
export function createSession(options: SessionOptions): Session {
  // Fixed fork order — style, instruments, arrangement, noise — so toggling
  // options never reshuffles another stream.
  const master = makeRng(options.seed ?? randomSeed());
  const styleRng = master.fork();
  const instrumentRng = master.fork();
  const arrangeRng = master.fork();
  const noiseRng = master.fork();

  const chosen = pickStyle(styleRng, options.style);
  const bpm = options.bpm ?? chosen.bpm;
  if (!(bpm > 0) || !Number.isFinite(bpm)) {
    throw new RangeError(`createSession: bpm must be a positive number, got ${bpm}`);
  }
  const beatsPerBar = options.beatsPerBar ?? 4;
  const bars = options.bars ?? 8;
  const evolve = options.evolve ?? true;

  const instruments: Record<ScoreVoice, Instrument> = {
    lead: pickInstrument(instrumentRng, chosen.instruments.lead),
    bass: pickInstrument(instrumentRng, chosen.instruments.bass),
    pad: pickInstrument(instrumentRng, chosen.instruments.pad),
    arp: pickInstrument(instrumentRng, chosen.instruments.arp),
  };
  const drumKit = DRUM_KITS.default;
  const noiseTable = makeNoiseTable(noiseRng);

  const arrangeOptions = (): ArrangeOptions => ({
    rng: arrangeRng,
    bpm,
    beatsPerBar,
    bars,
    parent: options.parent ?? chosen.parent,
    raga: options.raga ?? chosen.raga,
    rootMidi: options.rootMidi ?? chosen.rootMidi,
    groove: options.groove ?? chosen.groove,
    density: options.density ?? chosen.density,
    swing: options.swing ?? chosen.swing,
    ...(options.voices !== undefined ? { voices: options.voices } : {}),
  });

  let cachedScore: Score | null = null;
  return {
    noiseTable,
    bpm,
    beatsPerBar,
    bars,
    instruments,
    drumKit,
    nextScore(): Score {
      if (!evolve && cachedScore) return cachedScore;
      const score = arrange(arrangeOptions());
      if (!evolve) cachedScore = score;
      return score;
    },
  };
}
