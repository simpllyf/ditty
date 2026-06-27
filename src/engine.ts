/**
 * The public facade — wires the seeded RNG → melody stream → scheduler → synth
 * and exposes the small engine API. This is the only place the global
 * `AudioContext` is created (and only inside {@link PeppyEngine.start}, from a
 * user gesture), so importing the package and constructing the engine does no
 * audio work and is safe under SSR.
 */
import { MelodyStream } from "./melody";
import { PEPPY, STINGERS, STINGER_ROOT_MIDI, type StingerName } from "./presets";
import { makeRng } from "./rng";
import { degreeToFrequency } from "./scale";
import { Scheduler, type SchedulerClock } from "./scheduler";
import { type AudioContextLike, Synth } from "./synth";

/** The slice of `AudioContext` the engine drives; a real `AudioContext` satisfies it. */
export interface EngineAudioContext extends AudioContextLike {
  readonly state: AudioContextState;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

export interface EngineOptions {
  /** Omit for a fresh random seed each session; set for a reproducible stream. */
  seed?: number;
  /** Tempo in BPM. Default 128. */
  tempo?: number;
  /** Master volume, 0..1. Default 0.4 (it's background music). */
  volume?: number;
  /** Bring your own `AudioContext` (or compatible). Created internally if omitted. */
  audioContext?: EngineAudioContext;
  /** Advanced/testing: inject the scheduler's repeating timer. */
  clock?: SchedulerClock;
}

export interface PeppyEngine {
  /**
   * Create/resume the audio context and begin playing. **Call from a user
   * gesture** (click/tap/keydown) — browsers block audio until then. If called
   * outside a gesture it resolves but stays silent rather than throwing.
   */
  start(): Promise<void>;
  /** Play a one-shot reward flourish over the music, without interrupting it. */
  stinger(name: StingerName): void;
  /** Set master volume, 0..1. */
  setVolume(volume: number): void;
  /** Suspend audio, keeping state so {@link resume} continues. */
  pause(): void;
  /** Resume after {@link pause}. */
  resume(): void;
  /** Stop scheduling and silence, keeping the context for a later {@link start}. */
  stop(): void;
  /** Tear down all nodes and release the context (only if the engine created it). */
  dispose(): void;
}

// NaN must not slip through to an AudioParam (it silently corrupts the gain);
// fall back to the low bound. Infinity already clamps correctly via min/max.
const clamp = (x: number, lo: number, hi: number): number =>
  Number.isNaN(x) ? lo : Math.max(lo, Math.min(hi, x));

/** A 32-bit seed from Web Crypto, falling back to the clock (never Math.random). */
function randomSeed(): number {
  const webCrypto = globalThis.crypto;
  if (webCrypto?.getRandomValues) {
    return webCrypto.getRandomValues(new Uint32Array(1))[0] as number;
  }
  /* c8 ignore next -- only reached in environments without Web Crypto */
  return Date.now() >>> 0;
}

/** Create a peppy generative music engine. See {@link EngineOptions}. */
export function createPeppyEngine(options: EngineOptions = {}): PeppyEngine {
  const rng = makeRng(options.seed ?? randomSeed());
  const tempo = options.tempo ?? PEPPY.tempo;
  // Fail fast at the call site rather than deferring the error to start().
  if (!(tempo > 0) || !Number.isFinite(tempo)) {
    throw new RangeError(`createPeppyEngine: tempo must be a positive number, got ${tempo}`);
  }
  let volume = clamp(options.volume ?? PEPPY.volume, 0, 1);

  let context: EngineAudioContext | null = null;
  let synth: Synth | null = null;
  let scheduler: Scheduler | null = null;
  let ownsContext = false;
  let disposed = false;

  // Build the audio graph lazily, on the first start() (inside a user gesture).
  function ensureGraph(): void {
    if (context) return;
    context = options.audioContext ?? new AudioContext();
    ownsContext = !options.audioContext;
    synth = new Synth(context, { volume });
    const stream = new MelodyStream({
      rng,
      scale: PEPPY.scale,
      rootMidi: PEPPY.rootMidi,
      range: PEPPY.range,
      contourAmplitude: PEPPY.contourAmplitude,
      bass: PEPPY.bass,
      arp: PEPPY.arp,
    });
    scheduler = new Scheduler({
      stream,
      synth,
      context,
      tempo,
      ...(options.clock ? { clock: options.clock } : {}),
    });
  }

  return {
    async start(): Promise<void> {
      if (disposed) return;
      ensureGraph();
      await (context as EngineAudioContext).resume();
      if (disposed) return; // dispose() may have run during the await — don't start a dead graph
      (scheduler as Scheduler).start();
    },

    stinger(name: StingerName): void {
      if (!synth || !context) return; // nothing to layer over until start()
      const now = context.currentTime;
      for (const note of STINGERS[name]) {
        synth.play({
          voice: note.voice,
          frequency: degreeToFrequency(PEPPY.scale, note.degree, STINGER_ROOT_MIDI),
          startTime: now + note.timeOffset,
          durationSeconds: note.durationSeconds,
          velocity: note.velocity,
        });
      }
    },

    setVolume(value: number): void {
      volume = clamp(value, 0, 1);
      synth?.setVolume(volume);
    },

    pause(): void {
      if (disposed) return;
      scheduler?.stop();
      // Best-effort: a failing suspend (e.g. an externally-closed injected
      // context) is benign and must not surface as an unhandled rejection.
      void context?.suspend().catch(() => {});
    },

    resume(): void {
      if (disposed || !scheduler || !context) return;
      void context.resume().catch(() => {});
      scheduler.start();
    },

    stop(): void {
      scheduler?.stop();
      synth?.silenceAll();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      scheduler?.stop();
      synth?.dispose();
      if (ownsContext) void context?.close().catch(() => {});
    },
  };
}
