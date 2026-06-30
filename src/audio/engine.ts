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
  /** Master volume, 0..1. Default 0.3 — gentle, with headroom so dense mixes don't slam the limiter. */
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

// Suspend only well after the master fade has settled (the synth ramps it over ~0.25 s),
// so the freeze lands on silence — no click. Far past the fade and click-safe; saves CPU on a
// foreground pause. (On a hidden tab the timer is throttled and the OS suspends anyway; resume
// re-anchors regardless, so the exact timing isn't critical.)
const SUSPEND_AFTER_MS = 300;

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
  let volume = clamp(options.volume ?? 0.3, 0, 1);
  let graph: Graph | null = null;
  let disposed = false;
  let suspendTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelPendingSuspend = () => {
    if (suspendTimer !== null) {
      clearTimeout(suspendTimer);
      suspendTimer = null;
    }
  };

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
      cancelPendingSuspend();
      const { context, scheduler, synth } = ensureGraph();
      await context.resume();
      if (disposed) return; // dispose() may have run during the await
      scheduler.start();
      synth.fade(volume); // fade in (covers a (re)start from a faded state)
    },

    stop(): void {
      cancelPendingSuspend();
      graph?.scheduler.stop();
    },

    pause(): void {
      if (disposed || !graph) return;
      cancelPendingSuspend();
      const g = graph;
      g.synth.fade(0); // fade to silence FIRST...
      g.scheduler.pause();
      // ...then suspend well after the fade has settled, so the freeze is on silence — no click.
      suspendTimer = setTimeout(() => {
        suspendTimer = null;
        if (!disposed && graph === g) void g.context.suspend().catch(() => {});
      }, SUSPEND_AFTER_MS);
    },

    resume(): void {
      if (disposed || !graph) return;
      cancelPendingSuspend();
      const g = graph;
      g.synth.fade(volume); // ramp up from silence as we come back
      void g.context
        .resume()
        .then(() => {
          if (!disposed && graph === g) g.scheduler.resume(); // re-anchor on the now-running clock
        })
        .catch(() => {});
    },

    setVolume(value: number): void {
      volume = clamp(value, 0, 1);
      graph?.synth.setVolume(volume);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelPendingSuspend();
      graph?.scheduler.stop();
      graph?.synth.dispose();
      if (graph?.ownsContext) void graph.context.close().catch(() => {});
    },
  };
}
