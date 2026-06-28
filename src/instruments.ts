/**
 * Instruments — a DECLARATIVE patch registry (pure data, no Web Audio). Each patch
 * is a few summed oscillator layers + an amp envelope + an optional filter; the
 * synth (`synth.ts`) renders any of them. Adding an instrument is one
 * entry here, tagged with the voices it suits, and the randomizer picks it
 * automatically. Data only — must not import the audio shell.
 *
 * Palette is synthesized, not sampled (zero-dep + size budget): plucks, pads,
 * bells, organ, mallets, sub bass, etc. Broad on purpose.
 */
import type { DrumName, ScoreVoice } from "./voices";

export type OscKind = "sine" | "triangle" | "sawtooth" | "square";

/** One summed oscillator layer. `ratio` multiplies the note frequency; detune folds into frequency. */
export interface OscLayer {
  readonly kind: OscKind;
  readonly ratio?: number; // frequency multiple (1 = unison, 2 = octave, 2.76 = inharmonic bell)
  readonly detuneCents?: number;
  readonly gain?: number; // layer mix 0..1
}

/** Amplitude ADSR, in seconds (sustain is a 0..1 level). */
export interface AmpEnv {
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
}

/** Optional resonant filter with a downward cutoff envelope (for plucks/sweeps). */
export interface FilterPatch {
  readonly type: "lowpass" | "highpass" | "bandpass";
  readonly cutoff: number; // Hz, resting cutoff
  readonly q?: number;
  readonly envAmount?: number; // Hz added to cutoff at note start, decaying away
  readonly envDecay?: number; // seconds
}

export interface Instrument {
  readonly name: string;
  readonly voices: readonly ScoreVoice[]; // roles this patch suits → randomizer pool
  readonly layers: readonly OscLayer[];
  readonly amp: AmpEnv;
  readonly filter?: FilterPatch;
  readonly gain?: number; // output trim 0..1 (default 1)
  readonly reverbSend?: number; // 0..1 wet send (default = REVERB_SEND_BY_VOICE)
}

/** Default reverb send per voice when a patch doesn't specify one. */
export const REVERB_SEND_BY_VOICE: Readonly<Record<ScoreVoice, number>> = {
  lead: 0.2,
  bass: 0.05,
  pad: 0.5,
  arp: 0.35,
};

export const INSTRUMENTS = {
  // ── leads ──
  pluck: {
    name: "pluck",
    voices: ["lead", "arp"],
    layers: [{ kind: "sawtooth" }],
    amp: { attack: 0.005, decay: 0.14, sustain: 0.28, release: 0.16 },
    filter: { type: "lowpass", cutoff: 1400, q: 2, envAmount: 2600, envDecay: 0.14 },
    reverbSend: 0.2,
  },
  marimba: {
    name: "marimba",
    voices: ["lead", "arp"],
    layers: [{ kind: "triangle" }, { kind: "sine", ratio: 4, gain: 0.25 }],
    amp: { attack: 0.003, decay: 0.28, sustain: 0, release: 0.2 },
    reverbSend: 0.25,
  },
  squareLead: {
    name: "squareLead",
    voices: ["lead"],
    layers: [{ kind: "square" }, { kind: "square", detuneCents: 8, gain: 0.5 }],
    amp: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.12 },
    filter: { type: "lowpass", cutoff: 3000, q: 0.8 },
    gain: 0.85,
    reverbSend: 0.15,
  },
  sineLead: {
    name: "sineLead",
    voices: ["lead"],
    layers: [{ kind: "sine" }, { kind: "sine", ratio: 2, gain: 0.25 }],
    amp: { attack: 0.02, decay: 0.12, sustain: 0.6, release: 0.18 },
    reverbSend: 0.25,
  },

  // ── pads ──
  warmPad: {
    name: "warmPad",
    voices: ["pad"],
    layers: [
      { kind: "sawtooth" },
      { kind: "sawtooth", detuneCents: 10, gain: 0.6 },
      { kind: "sine", ratio: 0.5, gain: 0.4 },
    ],
    amp: { attack: 0.35, decay: 0.4, sustain: 0.85, release: 0.6 },
    filter: { type: "lowpass", cutoff: 1800, q: 0.6 },
    gain: 0.9,
    reverbSend: 0.55,
  },
  glassPad: {
    name: "glassPad",
    voices: ["pad"],
    layers: [{ kind: "triangle" }, { kind: "triangle", ratio: 2, detuneCents: 6, gain: 0.4 }],
    amp: { attack: 0.3, decay: 0.3, sustain: 0.8, release: 0.5 },
    reverbSend: 0.6,
  },
  organ: {
    name: "organ",
    voices: ["pad"],
    layers: [
      { kind: "sine" },
      { kind: "sine", ratio: 2, gain: 0.6 },
      { kind: "sine", ratio: 3, gain: 0.35 },
    ],
    amp: { attack: 0.02, decay: 0.1, sustain: 0.9, release: 0.2 },
    reverbSend: 0.3,
  },

  // ── bass ──
  subBass: {
    name: "subBass",
    voices: ["bass"],
    layers: [{ kind: "sine" }, { kind: "sine", ratio: 2, gain: 0.2 }],
    amp: { attack: 0.005, decay: 0.1, sustain: 0.85, release: 0.12 },
    reverbSend: 0.05,
  },
  roundBass: {
    name: "roundBass",
    voices: ["bass"],
    layers: [{ kind: "triangle" }, { kind: "sawtooth", gain: 0.3 }],
    amp: { attack: 0.005, decay: 0.12, sustain: 0.7, release: 0.12 },
    filter: { type: "lowpass", cutoff: 900, q: 0.8 },
    reverbSend: 0.08,
  },

  // ── arp / sparkle ──
  bell: {
    name: "bell",
    voices: ["arp"],
    layers: [
      { kind: "sine" },
      { kind: "sine", ratio: 2.76, gain: 0.4 },
      { kind: "sine", ratio: 5.4, gain: 0.15 },
    ],
    amp: { attack: 0.002, decay: 0.5, sustain: 0, release: 0.4 },
    reverbSend: 0.45,
  },
  musicBox: {
    name: "musicBox",
    voices: ["arp"],
    layers: [{ kind: "triangle" }, { kind: "triangle", ratio: 4, gain: 0.2 }],
    amp: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.3 },
    reverbSend: 0.4,
  },
  synthArp: {
    name: "synthArp",
    voices: ["arp", "lead"],
    layers: [{ kind: "square" }],
    amp: { attack: 0.004, decay: 0.12, sustain: 0.2, release: 0.1 },
    filter: { type: "lowpass", cutoff: 2200, q: 1.5, envAmount: 1800, envDecay: 0.1 },
    reverbSend: 0.3,
  },
} as const satisfies Record<string, Instrument>;

export type InstrumentName = keyof typeof INSTRUMENTS;

/** Instrument names suitable for a given voice (the randomizer's pool). */
export function instrumentsForVoice(voice: ScoreVoice): InstrumentName[] {
  return (Object.keys(INSTRUMENTS) as InstrumentName[]).filter((name) =>
    (INSTRUMENTS[name].voices as readonly ScoreVoice[]).includes(voice),
  );
}

/**
 * A synthesized drum hit. `kind` drives synthesis (so the synth is data-driven,
 * not keyed off the drum name): `tone` = a pitch-dropping body (kick), `noise` =
 * filtered noise (hat), `mixed` = noise + a body tone (snare).
 */
export interface DrumVoice {
  readonly kind: "tone" | "noise" | "mixed";
  readonly gain: number;
  readonly ampDecay: number; // seconds
  readonly freqStart?: number; // tone start (kick/snare body)
  readonly freqEnd?: number; // tone end (kick pitch drop)
  readonly pitchDecay?: number; // seconds
  readonly noiseGain?: number; // noise mix (snare/hat)
  readonly toneGain?: number; // tone mix (snare)
  readonly highpass?: number; // Hz, for noise (snare/hat)
}

export const DRUM_KITS = {
  default: {
    kick: {
      kind: "tone",
      gain: 0.9,
      ampDecay: 0.16,
      freqStart: 120,
      freqEnd: 48,
      pitchDecay: 0.03,
    },
    snare: {
      kind: "mixed",
      gain: 0.5,
      ampDecay: 0.14,
      freqStart: 190,
      noiseGain: 0.7,
      toneGain: 0.3,
      highpass: 1200,
    },
    hat: { kind: "noise", gain: 0.4, ampDecay: 0.05, noiseGain: 1, highpass: 7000 },
  },
} as const satisfies Record<string, Record<DrumName, DrumVoice>>;

export type DrumKitName = keyof typeof DRUM_KITS;
