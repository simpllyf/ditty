/**
 * The look-ahead scheduler — the timing-coupled shell around the pure stream.
 *
 * Follows the classic Web Audio "two clocks" pattern: a coarse ~25 ms timer
 * (the injected {@link SchedulerClock}) wakes up and schedules every note that
 * falls within the next ~100 ms against the audio clock's `currentTime`. It
 * pulls bars from a {@link NoteStream} as its buffer drains and translates
 * beats → absolute audio time using the tempo.
 *
 * *What* to schedule is pure (events from the stream, compared to currentTime);
 * only *when the timer fires* is impure — and that is injected, so the whole
 * thing is testable with a fake clock and a fake audio context.
 */
import type { NoteEvent } from "./melody";
import type { AudioContextLike, ScheduledNote } from "./synth";

/** The pure event source the scheduler pulls from (a `MelodyStream`). */
export interface NoteStream {
  next(): NoteEvent[];
}

/** The sink the scheduler feeds resolved notes to (a `Synth`). */
export interface NotePlayer {
  play(note: ScheduledNote): void;
}

/**
 * A repeating timer, encapsulated so the raw handle type never leaks. The
 * default uses the global timer; tests inject a fake whose `tick()` they drive.
 */
export interface SchedulerClock {
  start(callback: () => void, intervalMs: number): void;
  stop(): void;
}

export interface SchedulerOptions {
  /** The pure note source (infinite). */
  stream: NoteStream;
  /** The audio sink. */
  synth: NotePlayer;
  /** Provides the audio clock (`currentTime`). */
  context: AudioContextLike;
  /** Tempo in beats per minute. Default 128. */
  tempo?: number;
  /** How far ahead to schedule, in seconds. Default 0.1. */
  lookAheadSeconds?: number;
  /** How often the timer wakes, in milliseconds. Default 25. */
  intervalMs?: number;
  /** The repeating timer. Default wraps the global `setInterval`. */
  clock?: SchedulerClock;
}

const DEFAULT_TEMPO = 128;
const DEFAULT_LOOK_AHEAD_SECONDS = 0.1;
const DEFAULT_INTERVAL_MS = 25;
/** Refill safety cap: far above any real tempo/look-ahead combination. */
const MAX_REFILL_BARS = 1000;

function defaultClock(): SchedulerClock {
  let handle: ReturnType<typeof setInterval> | null = null;
  return {
    start(callback, intervalMs) {
      handle = setInterval(callback, intervalMs);
    },
    stop() {
      if (handle !== null) {
        clearInterval(handle);
        handle = null;
      }
    },
  };
}

export class Scheduler {
  private readonly stream: NoteStream;
  private readonly synth: NotePlayer;
  private readonly context: AudioContextLike;
  private readonly clock: SchedulerClock;
  private readonly secondsPerBeat: number;
  private readonly lookAheadSeconds: number;
  private readonly intervalMs: number;

  private running = false;
  private startTime = 0;
  /** Beat of the first event scheduled since the last start (the time anchor). */
  private firstBeat: number | null = null;
  private buffer: NoteEvent[] = [];

  constructor(options: SchedulerOptions) {
    const tempo = options.tempo ?? DEFAULT_TEMPO;
    if (!(tempo > 0) || !Number.isFinite(tempo)) {
      throw new RangeError(`scheduler tempo must be a positive number, got ${tempo}`);
    }
    this.stream = options.stream;
    this.synth = options.synth;
    this.context = options.context;
    this.clock = options.clock ?? defaultClock();
    this.secondsPerBeat = 60 / tempo;
    this.lookAheadSeconds = options.lookAheadSeconds ?? DEFAULT_LOOK_AHEAD_SECONDS;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  /** Whether the scheduler is currently running. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Begin scheduling. Anchors timing to the current audio time, starts the
   * timer, and schedules the first look-ahead window immediately. Idempotent.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.startTime = this.context.currentTime;
    this.firstBeat = null;
    this.buffer = [];
    this.clock.start(() => this.tick(), this.intervalMs);
    this.tick(); // don't wait a full interval for the first notes
  }

  /** Stop scheduling and drop any buffered-but-unscheduled notes. Idempotent. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.clock.stop();
    this.buffer = [];
    this.firstBeat = null;
  }

  private tick(): void {
    if (!this.running) return;
    const horizon = this.context.currentTime + this.lookAheadSeconds;
    this.refillUntil(horizon);
    while (
      this.buffer.length > 0 &&
      this.timeOf((this.buffer[0] as NoteEvent).startBeat) <= horizon
    ) {
      const event = this.buffer.shift() as NoteEvent;
      this.synth.play({
        voice: event.voice,
        frequency: event.frequency,
        // Never schedule in the past: if the timer ran late, start at "now".
        startTime: Math.max(this.timeOf(event.startBeat), this.context.currentTime),
        durationSeconds: event.durationBeats * this.secondsPerBeat,
        velocity: event.velocity,
      });
    }
  }

  /** Pull bars until the buffer reaches past the look-ahead horizon. */
  private refillUntil(horizon: number): void {
    let guard = 0;
    while (
      this.buffer.length === 0 ||
      this.timeOf((this.buffer[this.buffer.length - 1] as NoteEvent).startBeat) < horizon
    ) {
      const bar = this.stream.next();
      if (this.firstBeat === null && bar.length > 0) {
        this.firstBeat = (bar[0] as NoteEvent).startBeat;
      }
      this.buffer.push(...bar);
      if (++guard >= MAX_REFILL_BARS) break;
    }
  }

  /** Absolute audio time for a beat, anchored at the last start. */
  private timeOf(beat: number): number {
    return this.startTime + (beat - (this.firstBeat as number)) * this.secondsPerBeat;
  }
}
