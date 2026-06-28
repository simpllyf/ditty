/**
 * The public facade — wires the seed→music {@link Session} to a scheduler + synth
 * and exposes the engine API. The only place a global `AudioContext` is created
 * (lazily, inside {@link Engine.start} from a user gesture), so importing the
 * package and constructing the engine does no audio work and is SSR-safe.
 *
 * Instruments are chosen ONCE (stable timbre); when `evolve` is on (default) the
 * arrangement is regenerated each loop over the same tempo grid, so the music
 * never exactly repeats yet loops seamlessly.
 */
import type { Score } from "../compose/arranger";
import { clampSafe } from "../math";
import { type Session, type SessionOptions, createSession } from "../session";
import { buildLoop } from "./loop";
import { type PreparedLoop, Scheduler, type SchedulerClock } from "./scheduler";
import { type AudioContextLike, Synth } from "./synth";

/** The slice of `AudioContext` the engine drives; a real `AudioContext` satisfies it. */
export interface EngineAudioContext extends AudioContextLike {
  readonly state: AudioContextState;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

export interface EngineOptions extends SessionOptions {
  /** Master volume, 0..1. Default 0.35. */
  volume?: number;
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

// NaN-guarded clamp — a NaN volume must never reach the master AudioParam.
const clamp = clampSafe;

/** The audio graph, built lazily on first start(); null until then (SSR-safe). */
interface Graph {
  readonly context: EngineAudioContext;
  readonly synth: Synth;
  readonly scheduler: Scheduler;
  readonly ownsContext: boolean;
}

/** Create a generative music engine. See {@link EngineOptions}. */
export function createEngine(options: EngineOptions = {}): Engine {
  const session: Session = createSession(options); // chooses style/instruments once; validates bpm
  let volume = clamp(options.volume ?? 0.35, 0, 1);
  let graph: Graph | null = null;
  let disposed = false;

  function ensureGraph(): Graph {
    if (graph) return graph;
    const context = options.audioContext ?? (new AudioContext() as EngineAudioContext);
    const synth = new Synth(context, { noiseTable: session.noiseTable, masterGain: volume });
    // Reuse the prepared loop when the Score is unchanged (evolve:false caches it),
    // rebuilding only when the arrangement actually evolves.
    let lastScore: Score | null = null;
    let lastLoop: PreparedLoop | null = null;
    const scheduler = new Scheduler({
      context,
      provider: () => {
        const score = session.nextScore();
        if (score !== lastScore || !lastLoop) {
          lastScore = score;
          lastLoop = buildLoop(score, synth, session.instruments, session.drumKit);
        }
        return lastLoop;
      },
      ...(options.clock ? { clock: options.clock } : {}),
    });
    graph = { context, synth, scheduler, ownsContext: !options.audioContext };
    return graph;
  }

  return {
    async start(): Promise<void> {
      if (disposed) return;
      const { context, scheduler } = ensureGraph();
      await context.resume();
      if (disposed) return; // dispose() may have run during the await
      scheduler.start();
    },

    stop(): void {
      graph?.scheduler.stop();
    },

    pause(): void {
      if (disposed) return;
      graph?.scheduler.pause(); // keep position so resume() continues, not restarts
      void graph?.context.suspend().catch(() => {});
    },

    resume(): void {
      if (disposed || !graph) return;
      void graph.context.resume().catch(() => {});
      graph.scheduler.resume();
    },

    setVolume(value: number): void {
      volume = clamp(value, 0, 1);
      graph?.synth.setVolume(volume);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      graph?.scheduler.stop();
      graph?.synth.dispose();
      if (graph?.ownsContext) void graph.context.close().catch(() => {});
    },
  };
}
