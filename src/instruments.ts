/**
 * Instruments — a DECLARATIVE patch registry (pure data, no Web Audio). Each patch
 * is a few summed oscillator layers + an amp envelope + an optional filter; the
 * synth (`synth.ts`) renders any of them. Adding an instrument is one
 * entry here, tagged with the voices it suits, and the randomizer picks it
 * automatically. Data only — must not import the audio shell.
 *
 * Palette is synthesized, not sampled (zero-dep, lightweight): plucks, pads,
 * bells, organ, mallets, sub bass, etc. Broad on purpose.
 */
import type { DrumName, ScoreVoice } from "./voices";

export type OscKind = "sine" | "triangle" | "sawtooth" | "square";

/** An FM (phase-modulation) operator: a sine modulator bends a layer's frequency. */
export interface FmOp {
  readonly ratio: number; // modulator frequency ÷ carrier frequency (1 = unison, inharmonic = bell)
  readonly index: number; // modulation depth (brightness); peak deviation = index × modulator freq
  readonly decay?: number; // seconds for the index to fall toward 0 — the e-piano/bell "tine"
}

/** One summed oscillator layer. `ratio` multiplies the note frequency; detune folds into frequency. */
export interface OscLayer {
  readonly kind: OscKind;
  readonly ratio?: number; // frequency multiple (1 = unison, 2 = octave, 2.76 = inharmonic bell)
  readonly detuneCents?: number;
  readonly gain?: number; // layer mix 0..1
  readonly fm?: FmOp; // optional FM modulator → metallic/e-piano/bell timbres
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

/** Pitch vibrato: an LFO on each layer's detune, optionally eased in after onset. */
export interface Vibrato {
  readonly rateHz: number; // LFO speed (≈ 4–7 Hz is natural)
  readonly depthCents: number; // peak pitch deviation in cents
  readonly delaySec?: number; // ease the depth in over this long (0 = immediate)
}

/** Amplitude tremolo: an LFO on the note's gain. */
export interface Tremolo {
  readonly rateHz: number;
  readonly depth: number; // 0..1 — fraction of the signal the LFO swings
}

/** A breath/bow noise component mixed into a note (follows the amp envelope). */
export interface NoiseLayer {
  readonly gain: number; // mix level 0..1 (subtle — a few %)
  readonly highpass?: number; // Hz — air/breath sits up high
  readonly lowpass?: number; // Hz — optional top roll-off
}

/** One vocal formant — a resonant band-pass peak. A few in parallel shape a buzzy
 * source into a vowel (the "aah"/"ooh" of a voice or choir). */
export interface Formant {
  readonly freq: number; // centre frequency in Hz (F1/F2/F3 of the vowel)
  readonly q: number; // resonance (higher = narrower, more vocal)
  readonly gain: number; // band mix 0..1
}

export interface Instrument {
  readonly name: string;
  readonly voices: readonly ScoreVoice[]; // roles this patch suits → randomizer pool
  readonly layers: readonly OscLayer[];
  readonly amp: AmpEnv;
  readonly filter?: FilterPatch;
  readonly gain?: number; // output trim 0..1 (default 1)
  readonly reverbSend?: number; // 0..1 wet send (default = REVERB_SEND_BY_VOICE)
  readonly vibrato?: Vibrato; // pitch LFO (flute/strings/voice)
  readonly tremolo?: Tremolo; // amplitude LFO (organ/pad shimmer)
  readonly noise?: NoiseLayer; // breath/bow noise (flute/strings/reed)
  readonly formant?: readonly Formant[]; // parallel band-pass bank → vowel/choir timbre
}

/** Default reverb send per voice when a patch doesn't specify one. */
export const REVERB_SEND_BY_VOICE: Readonly<Record<ScoreVoice, number>> = {
  lead: 0.2,
  bass: 0.05,
  pad: 0.5,
  arp: 0.35,
};

/** Mix balance per voice (multiplies note velocity at playback). Brings the lead
 * melody forward of the bed (pad/arp) so it cuts through. Audio-layer only — does
 * not change the Score. */
export const MIX_BY_VOICE: Readonly<Record<ScoreVoice, number>> = {
  lead: 1.12,
  bass: 1.0,
  pad: 0.82,
  arp: 0.88,
};

/** Stereo placement per voice (-1 left .. 1 right). Lead/bass centred (melody up
 * front, low end mono-solid); pad and arp opposed for width. Drums play centred. */
export const PAN_BY_VOICE: Readonly<Record<ScoreVoice, number>> = {
  lead: 0,
  bass: 0,
  pad: -0.3,
  arp: 0.3,
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
    vibrato: { rateHz: 5, depthCents: 9, delaySec: 0.6 }, // a gentle, late shimmer (not a wobble)
    reverbSend: 0.25,
  },
  airLead: {
    name: "airLead",
    // An airy, breathy soft lead (honestly NOT a flute — blown instruments need a
    // breath model/samples). Shows off the noise layer as a gentle texture.
    voices: ["lead"],
    layers: [{ kind: "sine" }, { kind: "sine", ratio: 2, gain: 0.06 }],
    amp: { attack: 0.06, decay: 0.1, sustain: 0.7, release: 0.18 }, // soft onset
    vibrato: { rateHz: 5, depthCents: 12, delaySec: 0.4 },
    noise: { gain: 0.05, highpass: 2000 }, // a wisp of air
    reverbSend: 0.3,
  },
  clarinet: {
    name: "clarinet",
    // Reed: a hollow square (odd harmonics) with breath + gentle vibrato.
    voices: ["lead"],
    layers: [{ kind: "square" }],
    amp: { attack: 0.04, decay: 0.1, sustain: 0.8, release: 0.15 },
    filter: { type: "lowpass", cutoff: 1800, q: 0.7 },
    vibrato: { rateHz: 5, depthCents: 7, delaySec: 0.5 },
    noise: { gain: 0.03, highpass: 2500 }, // breath
    gain: 0.7, // square runs hot
    reverbSend: 0.25,
  },
  synthBrass: {
    name: "synthBrass",
    // Brass: bright detuned saws with a filter "bloom" on the attack + a wisp of air.
    voices: ["lead", "pad"],
    layers: [{ kind: "sawtooth" }, { kind: "sawtooth", detuneCents: 6, gain: 0.5 }],
    amp: { attack: 0.04, decay: 0.2, sustain: 0.8, release: 0.2 },
    filter: { type: "lowpass", cutoff: 1200, q: 1, envAmount: 2400, envDecay: 0.12 },
    vibrato: { rateHz: 5, depthCents: 6, delaySec: 0.5 },
    noise: { gain: 0.02, highpass: 4000 },
    gain: 0.9,
    reverbSend: 0.25,
  },
  supersaw: {
    name: "supersaw",
    // Lush stacked detuned saws — a rich synth lead/pad.
    voices: ["lead", "pad"],
    layers: [
      { kind: "sawtooth" },
      { kind: "sawtooth", detuneCents: 12, gain: 0.7 },
      { kind: "sawtooth", detuneCents: -12, gain: 0.7 },
      { kind: "sawtooth", detuneCents: 24, gain: 0.4 },
    ],
    amp: { attack: 0.02, decay: 0.2, sustain: 0.75, release: 0.25 },
    filter: { type: "lowpass", cutoff: 2600, q: 0.6 },
    vibrato: { rateHz: 4.5, depthCents: 6, delaySec: 0.6 },
    gain: 0.8, // four saws sum hot
    reverbSend: 0.3,
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
    tremolo: { rateHz: 4.5, depth: 0.16 }, // subtle Leslie-ish shimmer
    reverbSend: 0.3,
  },
  epiano: {
    name: "epiano",
    voices: ["lead", "pad"],
    // FM Rhodes: a sine carrier with a unison modulator whose brightness decays
    // into a soft tine, plus a faint octave shimmer.
    layers: [
      { kind: "sine", fm: { ratio: 1, index: 2.5, decay: 0.35 } },
      { kind: "sine", ratio: 2, gain: 0.12 },
    ],
    amp: { attack: 0.005, decay: 0.7, sustain: 0.3, release: 0.5 },
    reverbSend: 0.32,
  },
  strings: {
    name: "strings",
    // Ensemble strings: three detuned saws, slow swell, bow noise + vibrato.
    voices: ["pad", "lead"],
    layers: [
      { kind: "sawtooth" },
      { kind: "sawtooth", detuneCents: 11, gain: 0.7 },
      { kind: "sawtooth", detuneCents: -7, gain: 0.5 },
    ],
    amp: { attack: 0.25, decay: 0.3, sustain: 0.85, release: 0.5 },
    filter: { type: "lowpass", cutoff: 2400, q: 0.6 },
    vibrato: { rateHz: 5.5, depthCents: 8, delaySec: 0.5 },
    noise: { gain: 0.03, highpass: 3000 }, // bow
    gain: 0.9,
    reverbSend: 0.5,
  },
  choir: {
    name: "choir",
    // Voices on "aah": detuned saws run through a vowel formant bank, with a slow
    // swell, vibrato and a wisp of breath. The formant peaks make it read as vocal.
    voices: ["pad", "lead"],
    layers: [{ kind: "sawtooth" }, { kind: "sawtooth", detuneCents: 9, gain: 0.5 }],
    amp: { attack: 0.18, decay: 0.25, sustain: 0.85, release: 0.45 },
    formant: [
      { freq: 800, q: 8, gain: 1 }, // F1 "aah"
      { freq: 1150, q: 10, gain: 0.6 }, // F2
      { freq: 2900, q: 12, gain: 0.3 }, // F3
    ],
    vibrato: { rateHz: 5, depthCents: 14, delaySec: 0.5 },
    noise: { gain: 0.03, highpass: 3000 }, // breath
    gain: 0.6, // saws + resonant bands run hot
    reverbSend: 0.55,
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
  glockenspiel: {
    name: "glockenspiel",
    // Bright metallic ping via inharmonic FM, fast tine decay.
    voices: ["arp"],
    layers: [
      { kind: "sine", fm: { ratio: 3.5, index: 4, decay: 0.18 } },
      { kind: "sine", gain: 0.5 },
    ],
    amp: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.45 },
    reverbSend: 0.45,
  },
  celesta: {
    name: "celesta",
    // Sweet mallet-bell: harmonic FM, gentler index than the glock, soft decay.
    voices: ["arp", "pad"],
    layers: [
      { kind: "sine", fm: { ratio: 3, index: 2, decay: 0.3 } },
      { kind: "sine", gain: 0.4 },
    ],
    amp: { attack: 0.002, decay: 0.6, sustain: 0, release: 0.5 },
    reverbSend: 0.42,
  },
  tubularBell: {
    name: "tubularBell",
    // Big church bell: inharmonic FM partials, long ring.
    voices: ["arp", "pad"],
    layers: [
      { kind: "sine", fm: { ratio: 1.4, index: 5, decay: 0.6 } },
      { kind: "sine", ratio: 2.8, gain: 0.3 },
    ],
    amp: { attack: 0.002, decay: 1.2, sustain: 0, release: 1.0 },
    reverbSend: 0.55,
  },
  harp: {
    name: "harp",
    // Soft plucked string: warm triangle, quick bloom, gentle decay.
    voices: ["arp", "lead"],
    layers: [{ kind: "triangle" }, { kind: "sine", ratio: 2, gain: 0.3 }],
    amp: { attack: 0.002, decay: 0.6, sustain: 0, release: 0.5 },
    filter: { type: "lowpass", cutoff: 3000, q: 0.5 },
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

  // ── drone ──
  tanpura: {
    name: "tanpura",
    // The raga drone, plucked string by string and left to ring long, so consecutive
    // plucks overlap into one continuous shimmer. Harmonically RICH on purpose (a
    // sawtooth pair with a hair of detune — the tanpura's jivari shimmer — plus an
    // octave), so the drone's energy climbs into the mid instead of piling up on the
    // fundamental the way a sine bass does; that is what keeps it present and stops it
    // asking a small speaker to reproduce one loud low tone. No vibrato, no breath
    // noise: the shimmer is the pitch, not a wobble on top of it.
    voices: ["arp"],
    layers: [
      { kind: "sawtooth", gain: 0.5 },
      { kind: "sawtooth", detuneCents: 5, gain: 0.35 },
      { kind: "sine", ratio: 2, gain: 0.25 },
    ],
    amp: { attack: 0.008, decay: 2.0, sustain: 0.22, release: 1.5 },
    // A bright bloom on the pluck that settles to a mellow ring — the jivari sparkle
    // without a noise layer.
    filter: { type: "lowpass", cutoff: 1600, q: 1, envAmount: 2400, envDecay: 0.7 },
    gain: 0.6,
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
 * A synthesized drum hit, as a discriminated union on `kind` so each variant
 * carries exactly the fields its synthesis needs (illegal patches don't typecheck;
 * the synth is data-driven, not keyed off the drum name):
 * - `tone`  — a pitch-dropping body (kick): a sine swept `freqStart → freqEnd`.
 * - `noise` — filtered noise (hat).
 * - `mixed` — noise + a body tone (snare).
 */
export type DrumVoice =
  | {
      readonly kind: "tone";
      readonly gain: number;
      readonly ampDecay: number; // seconds
      readonly freqStart: number; // tone start
      readonly freqEnd: number; // tone end (pitch drop)
      readonly pitchDecay?: number; // seconds
    }
  | {
      readonly kind: "noise";
      readonly gain: number;
      readonly ampDecay: number;
      readonly noiseGain: number; // noise mix 0..1
      readonly highpass?: number; // Hz
    }
  | {
      readonly kind: "mixed";
      readonly gain: number;
      readonly ampDecay: number;
      readonly freqStart: number; // body tone frequency
      readonly noiseGain: number; // noise mix 0..1
      readonly toneGain: number; // body tone mix 0..1
      readonly highpass?: number; // Hz
    };

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

/** The pitch a drum voice is heard at, or null for pure noise (a hat has none). */
function bodyPitch(voice: DrumVoice): number | null {
  if (voice.kind === "tone") return voice.freqEnd; // where the sweep settles
  if (voice.kind === "mixed") return voice.freqStart;
  return null;
}

/**
 * Semitones to the nearest tonic or fifth. Both are consonant against the key, and
 * offering two targets means no drum ever moves more than a minor third to reach one —
 * so a kit keeps the character it was voiced with.
 */
function shiftToConsonance(freq: number, rootMidi: number): number {
  const pc = (n: number) => ((n % 12) + 12) % 12;
  const from = pc(Math.round(69 + 12 * Math.log2(freq / 440)));
  let best = 0;
  let bestDistance = Infinity;
  for (const target of [0, 7]) {
    let shift = (pc(rootMidi + target) - from + 12) % 12;
    if (shift > 6) shift -= 12; // take the shorter way — down a fourth, not up a fifth
    if (Math.abs(shift) < bestDistance) {
      bestDistance = Math.abs(shift);
      best = shift;
    }
  }
  return best;
}

/**
 * Tune a kit to the piece's key. Body tones are authored as fixed frequencies, so in
 * most keys they sound a fixed note against the harmony: the default kick settles on G
 * — a tritone from a C# tonic — and the snare's tone sits on F# under every backbeat.
 *
 * Each pitched drum moves to the nearest tonic or fifth. Tuning them TOGETHER, as one
 * ratio, would look tidier but carries the kit's own intervals along with it: this kit
 * voices its snare a semitone under its kick, which would then sound a flat second
 * against every tonic instead of only against G. Drums are tuned to the key, not to
 * each other.
 */
export function tuneKit(
  kit: Record<DrumName, DrumVoice>,
  rootMidi: number,
): Record<DrumName, DrumVoice> {
  const tuned = {} as Record<DrumName, DrumVoice>;
  for (const [name, voice] of Object.entries(kit) as [DrumName, DrumVoice][]) {
    const body = bodyPitch(voice);
    if (body === null || !(body > 0) || voice.kind === "noise") {
      tuned[name] = voice; // pure noise has no pitch to tune
      continue;
    }
    const ratio = 2 ** (shiftToConsonance(body, rootMidi) / 12);
    tuned[name] =
      voice.kind === "tone"
        ? { ...voice, freqStart: voice.freqStart * ratio, freqEnd: voice.freqEnd * ratio }
        : { ...voice, freqStart: voice.freqStart * ratio };
  }
  return tuned;
}
