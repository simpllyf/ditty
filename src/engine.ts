/**
 * The public facade — wires seed → arranger → scheduler → synth and exposes the
 * engine API. The only place a global `AudioContext` is created (lazily, inside
 * {@link Engine.start} from a user gesture), so importing the package and
 * constructing the engine does no audio work and is SSR-safe.
 *
 * Instruments are chosen ONCE (stable timbre); when `evolve` is on (default) the
 * arrangement is regenerated each loop over the same tempo grid, so the music
 * never exactly repeats yet loops seamlessly.
 */
import {
  type ArrangeOptions,
  type DrumName,
  type Score,
  type ScoreVoice,
  arrange,
} from "./compose/arranger";
import {
  DRUM_KITS,
  type DrumVoice,
  INSTRUMENTS,
  type Instrument,
  REVERB_SEND_BY_VOICE,
  instrumentsForVoice,
} from "./instruments";
import { makeNoiseTable } from "./noise";
import { type Rng, makeRng } from "./rng";
import { type PreparedLoop, Scheduler, type SchedulerClock } from "./scheduler";
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
  bpm?: number;
  beatsPerBar?: number;
  bars?: number;
  parent?: ArrangeOptions["parent"];
  raga?: ArrangeOptions["raga"];
  rootMidi?: number;
  groove?: ArrangeOptions["groove"];
  density?: number;
  swing?: number;
  voices?: ArrangeOptions["voices"];
  /** Master volume, 0..1. Default 0.35. */
  volume?: number;
  /** Re-arrange each loop for endless variety (default true); false repeats one loop. */
  evolve?: boolean;
  /** Bring your own `AudioContext` (or compatible). Created internally if omitted. */
  audioContext?: EngineAudioContext;
  /** Advanced/testing: inject the scheduler's repeating timer. */
  clock?: SchedulerClock;
}

export interface Engine {
  /** Create/resume the context and begin playing. **Call from a user gesture.** */
  start(): Promise<void>;
  /** Stop scheduling and silence (keeps the context for a later start). */
  stop(): void;
  /** Suspend audio, keeping state so {@link resume} continues. */
  pause(): void;
  /** Resume after {@link pause}. */
  resume(): void;
  /** Set master volume, 0..1. */
  setVolume(volume: number): void;
  /** Tear down all nodes and release the context (only if the engine created it). */
  dispose(): void;
}

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

function pickInstrument(rng: Rng, voice: ScoreVoice): Instrument {
  const names = instrumentsForVoice(voice);
  return INSTRUMENTS[rng.pick(names)];
}

/** Turn a Score + chosen instruments into a sorted, beat-stamped loop for the scheduler. */
function buildLoop(
  score: Score,
  synth: Synth,
  instruments: Record<ScoreVoice, Instrument>,
  drumKit: Record<DrumName, DrumVoice>,
): PreparedLoop {
  const secondsPerBeat = 60 / score.bpm;
  const events = [];
  for (const part of score.parts) {
    const patch = instruments[part.voice];
    const reverbSend = patch.reverbSend ?? REVERB_SEND_BY_VOICE[part.voice];
    for (const note of part.notes) {
      events.push({
        beat: note.startBeat,
        play: (time: number) =>
          synth.playNote(patch, {
            freq: note.freq,
            startTime: time,
            durationSeconds: note.durationBeats * secondsPerBeat,
            velocity: note.velocity,
            reverbSend,
          }),
      });
    }
  }
  for (const hit of score.drums) {
    events.push({
      beat: hit.startBeat,
      play: (time: number) => synth.playDrum(hit.drum, drumKit[hit.drum], time, hit.velocity),
    });
  }
  events.sort((a, b) => a.beat - b.beat);
  return { events, loopBeats: score.lengthBeats, secondsPerBeat };
}

/** Create a generative music engine. See {@link EngineOptions}. */
export function createEngine(options: EngineOptions = {}): Engine {
  const bpm = options.bpm ?? 100;
  if (!(bpm > 0) || !Number.isFinite(bpm)) {
    throw new RangeError(`createEngine: bpm must be a positive number, got ${bpm}`);
  }
  const beatsPerBar = options.beatsPerBar ?? 4;
  const bars = options.bars ?? 8;
  const evolve = options.evolve ?? true;
  let volume = clamp(options.volume ?? 0.35, 0, 1);

  // Deterministic sub-streams: instruments (once), arrangement (advances per loop), noise.
  const master = makeRng(options.seed ?? randomSeed());
  const instrumentRng = master.fork();
  const arrangeRng = master.fork();
  const noiseRng = master.fork();

  const instruments: Record<ScoreVoice, Instrument> = {
    lead: pickInstrument(instrumentRng, "lead"),
    bass: pickInstrument(instrumentRng, "bass"),
    pad: pickInstrument(instrumentRng, "pad"),
    arp: pickInstrument(instrumentRng, "arp"),
  };
  const drumKit = DRUM_KITS.default;
  const noiseTable = makeNoiseTable(noiseRng);

  const arrangeOptions = (): ArrangeOptions => ({
    rng: arrangeRng,
    bpm,
    beatsPerBar,
    bars,
    ...(options.parent !== undefined ? { parent: options.parent } : {}),
    ...(options.raga !== undefined ? { raga: options.raga } : {}),
    ...(options.rootMidi !== undefined ? { rootMidi: options.rootMidi } : {}),
    ...(options.groove !== undefined ? { groove: options.groove } : {}),
    ...(options.density !== undefined ? { density: options.density } : {}),
    ...(options.swing !== undefined ? { swing: options.swing } : {}),
    ...(options.voices !== undefined ? { voices: options.voices } : {}),
  });

  let context: EngineAudioContext | null = null;
  let synth: Synth | null = null;
  let scheduler: Scheduler | null = null;
  let cachedLoop: PreparedLoop | null = null;
  let ownsContext = false;
  let disposed = false;

  function provide(): PreparedLoop {
    if (!evolve && cachedLoop) return cachedLoop;
    const loop = buildLoop(arrange(arrangeOptions()), synth as Synth, instruments, drumKit);
    if (!evolve) cachedLoop = loop;
    return loop;
  }

  function ensureGraph(): void {
    if (context) return;
    context = options.audioContext ?? (new AudioContext() as EngineAudioContext);
    ownsContext = !options.audioContext;
    synth = new Synth(context, { noiseTable, masterGain: volume });
    scheduler = new Scheduler({
      context,
      provider: provide,
      ...(options.clock ? { clock: options.clock } : {}),
    });
  }

  return {
    async start(): Promise<void> {
      if (disposed) return;
      ensureGraph();
      await (context as EngineAudioContext).resume();
      if (disposed) return; // dispose() may have run during the await
      (scheduler as Scheduler).start();
    },

    stop(): void {
      scheduler?.stop();
    },

    pause(): void {
      if (disposed) return;
      scheduler?.stop();
      void context?.suspend().catch(() => {});
    },

    resume(): void {
      if (disposed || !scheduler || !context) return;
      void context.resume().catch(() => {});
      scheduler.start();
    },

    setVolume(value: number): void {
      volume = clamp(value, 0, 1);
      synth?.setVolume(volume);
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
