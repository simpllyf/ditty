/**
 * The synth — the only code in the engine that touches Web Audio.
 *
 * It turns scheduled notes into sound: each note is a fresh oscillator through a
 * per-note ADSR gain into a shared master gain into the destination. Oscillators
 * are single-use in Web Audio, so allocating one per note is the idiomatic
 * pattern; polyphony is bounded by a voice cap with oldest-first stealing, and
 * finished voices are swept on the next {@link Synth.play}.
 *
 * The `AudioContext` is **injected** (never the global) so the whole thing runs
 * against a fake context in tests — no real audio required.
 */
import type { Voice } from "./melody";

/** The slice of `AudioParam` the synth uses. */
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  cancelScheduledValues(startTime: number): void;
}

/** The slice of `AudioNode` the synth uses. */
export interface AudioNodeLike {
  connect(destination: AudioNodeLike): void;
  disconnect(): void;
}

/** The slice of `GainNode` the synth uses. */
export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

/** The slice of `OscillatorNode` the synth uses. */
export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorType;
  readonly frequency: AudioParamLike;
  start(when: number): void;
  stop(when: number): void;
}

/** The slice of `AudioContext` the synth uses; a real `AudioContext` satisfies it. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  createOscillator(): OscillatorNodeLike;
  createGain(): GainNodeLike;
}

/** A note resolved to absolute audio time and seconds — what the scheduler hands the synth. */
export interface ScheduledNote {
  readonly voice: Voice;
  /** Pitch in Hz. */
  readonly frequency: number;
  /** Absolute start time on the audio clock. */
  readonly startTime: number;
  /** How long to hold before release, in seconds. */
  readonly durationSeconds: number;
  /** Loudness, 0..1. */
  readonly velocity: number;
}

export interface SynthOptions {
  /** Master volume, 0..1. Default 0.4 (it's background music). */
  volume?: number;
  /** Maximum simultaneously-sounding voices before stealing the oldest. */
  maxVoices?: number;
}

/** A bright, plucky envelope + timbre per layer (snappy attacks for bounce). */
interface Timbre {
  readonly type: OscillatorType;
  readonly attack: number; // seconds
  readonly decay: number;
  readonly sustain: number; // fraction of peak, 0..1
  readonly release: number;
  readonly gain: number; // peak level relative to velocity
}

const TIMBRES: Record<Voice, Timbre> = {
  lead: { type: "square", attack: 0.005, decay: 0.06, sustain: 0.5, release: 0.08, gain: 0.5 },
  bass: { type: "triangle", attack: 0.005, decay: 0.08, sustain: 0.6, release: 0.12, gain: 0.6 },
  arp: { type: "square", attack: 0.003, decay: 0.04, sustain: 0.3, release: 0.05, gain: 0.35 },
};

/** Small tail after release so stop() never clips the envelope's end. */
const TAIL_SECONDS = 0.02;

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

interface ActiveVoice {
  readonly osc: OscillatorNodeLike;
  readonly env: GainNodeLike;
  readonly endTime: number;
}

export class Synth {
  private readonly context: AudioContextLike;
  private readonly master: GainNodeLike;
  private readonly maxVoices: number;
  private readonly active: ActiveVoice[] = [];
  private volumeValue: number;
  private disposed = false;

  constructor(context: AudioContextLike, options: SynthOptions = {}) {
    this.context = context;
    this.maxVoices = Math.max(1, Math.floor(options.maxVoices ?? 16));
    this.volumeValue = clamp(options.volume ?? 0.4, 0, 1);
    this.master = context.createGain();
    this.master.gain.setValueAtTime(this.volumeValue, context.currentTime);
    this.master.connect(context.destination);
  }

  /** Current master volume, 0..1. */
  get volume(): number {
    return this.volumeValue;
  }

  /** Set master volume (0..1), clamped. A no-op after {@link dispose}. */
  setVolume(volume: number): void {
    if (this.disposed) return;
    this.volumeValue = clamp(volume, 0, 1);
    this.master.gain.setValueAtTime(this.volumeValue, this.context.currentTime);
  }

  /** Schedule one note. A no-op after {@link dispose}. */
  play(note: ScheduledNote): void {
    if (this.disposed) return;
    this.sweepFinished();
    if (this.active.length >= this.maxVoices) this.stealOldest();

    const timbre = TIMBRES[note.voice];
    const osc = this.context.createOscillator();
    const env = this.context.createGain();
    osc.type = timbre.type;
    osc.frequency.setValueAtTime(note.frequency, note.startTime);
    osc.connect(env);
    env.connect(this.master);

    const peak = clamp(note.velocity, 0, 1) * timbre.gain;
    const sustainLevel = peak * timbre.sustain;
    const start = note.startTime;
    const g = env.gain;
    g.setValueAtTime(0, start);
    g.linearRampToValueAtTime(peak, start + timbre.attack);
    g.linearRampToValueAtTime(sustainLevel, start + timbre.attack + timbre.decay);
    // Hold sustain until the note ends, then release. Clamp so a note shorter
    // than attack+decay still releases cleanly rather than going backwards.
    const releaseStart = Math.max(
      start + timbre.attack + timbre.decay,
      start + note.durationSeconds,
    );
    g.setValueAtTime(sustainLevel, releaseStart);
    g.linearRampToValueAtTime(0, releaseStart + timbre.release);

    const endTime = releaseStart + timbre.release + TAIL_SECONDS;
    osc.start(start);
    osc.stop(endTime);
    this.active.push({ osc, env, endTime });
  }

  /** Cut all sounding voices immediately (for stop). */
  silenceAll(): void {
    const now = this.context.currentTime;
    for (const voice of this.active) {
      voice.osc.stop(now);
      voice.osc.disconnect();
      voice.env.disconnect();
    }
    this.active.length = 0;
  }

  /** Tear down: silence everything and release the master node. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.silenceAll();
    this.master.disconnect();
    this.disposed = true;
  }

  private sweepFinished(): void {
    const now = this.context.currentTime;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const voice = this.active[i] as ActiveVoice;
      if (voice.endTime <= now) {
        voice.osc.disconnect();
        voice.env.disconnect();
        this.active.splice(i, 1);
      }
    }
  }

  private stealOldest(): void {
    const voice = this.active.shift();
    if (!voice) return;
    voice.osc.stop(this.context.currentTime);
    voice.osc.disconnect();
    voice.env.disconnect();
  }
}
