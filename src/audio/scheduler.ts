/**
 * The look-ahead scheduler — the timing shell. Classic Web Audio "two clocks":
 * a coarse ~25 ms timer (the injected {@link SchedulerClock}) wakes up and
 * schedules every event due within the next ~100 ms against the audio clock.
 *
 * It plays a {@link PreparedLoop} (a sorted, beat-stamped event list from the
 * engine) and, at each loop boundary, asks the `provider` for the next loop —
 * which may be the same loop again (repeat) or a freshly arranged one (evolve).
 * Loop length is constant, so the seam is seamless.
 *
 * *What* to schedule is pure (events vs. currentTime); only *when the timer
 * fires* is impure — and that is injected, so it tests with a fake clock + ctx.
 */

/** One beat-stamped action; `play` is called with the resolved absolute audio time. */
export interface ScheduledEvent {
  readonly beat: number;
  play(timeSeconds: number): void;
}

/** One loop's worth of events (sorted by beat), its length, and tempo. */
export interface PreparedLoop {
  readonly events: readonly ScheduledEvent[];
  readonly loopBeats: number;
  readonly secondsPerBeat: number;
}

/** A repeating timer, encapsulated so the raw handle never leaks. */
export interface SchedulerClock {
  start(callback: () => void, intervalMs: number): void;
  stop(): void;
}

export interface SchedulerOptions {
  /** Provides the audio clock (`currentTime`). */
  context: { readonly currentTime: number };
  /** Called at start and at each loop boundary to get the loop to play next. */
  provider: () => PreparedLoop;
  /** How far ahead to schedule, in seconds. Default 0.1. */
  lookAheadSeconds?: number;
  /** How often the timer wakes, in milliseconds. Default 25. */
  intervalMs?: number;
  /** The repeating timer. Default wraps the global `setInterval`. */
  clock?: SchedulerClock;
}

const DEFAULT_LOOK_AHEAD_SECONDS = 0.1;
const DEFAULT_INTERVAL_MS = 25;
/** Safety cap on iterations per tick: far above any real look-ahead/loop combination. */
const MAX_STEPS_PER_TICK = 100_000;
/**
 * Events overdue by more than this are dropped rather than fired at "now". A
 * throttled/backgrounded timer can wake with the audio clock far ahead; without
 * this, every missed note would collapse onto the current instant — an audible
 * burst. Normal timer jitter (< this) still plays, slightly late.
 */
const MAX_LATENESS_SECONDS = 0.25;

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
  private readonly context: { readonly currentTime: number };
  private readonly provider: () => PreparedLoop;
  private readonly clock: SchedulerClock;
  private readonly lookAheadSeconds: number;
  private readonly intervalMs: number;

  private running = false;
  private anchor = 0; // audio time of the current loop's beat 0
  private index = 0; // next event in the current loop
  private loop: PreparedLoop | null = null;

  constructor(options: SchedulerOptions) {
    this.context = options.context;
    this.provider = options.provider;
    this.clock = options.clock ?? defaultClock();
    this.lookAheadSeconds = options.lookAheadSeconds ?? DEFAULT_LOOK_AHEAD_SECONDS;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Begin scheduling, anchored at the current audio time. Idempotent. */
  start(): void {
    if (this.running) return;
    // Obtain the first loop BEFORE flipping `running`, so a throwing provider
    // surfaces the error without leaving the scheduler half-started (unstartable).
    const loop = this.provider();
    this.running = true;
    this.anchor = this.context.currentTime;
    this.loop = loop;
    this.index = 0;
    this.clock.start(() => this.tick(), this.intervalMs);
    this.tick(); // don't wait a full interval for the first notes
  }

  /** Stop scheduling and reset position. Already-scheduled audio still plays out. Idempotent. */
  stop(): void {
    if (!this.running && !this.loop) return; // already fully stopped (vs merely paused)
    this.running = false;
    this.clock.stop();
    this.loop = null;
  }

  /** Pause the timer, keeping the loop so {@link resume} continues it. No-op if not running. */
  pause(): void {
    if (!this.running) return;
    this.running = false;
    this.clock.stop();
  }

  /**
   * Resume after {@link pause}, RE-ANCHORED to the current time. While paused the audio
   * clock may have advanced (some browsers keep the context running when hidden), so
   * replaying the same loop against a stale anchor would drop a burst of overdue events
   * — an audible glitch on the way back. Restart the loop from its head at "now" instead,
   * seamless for a background bed. No-op if never started.
   */
  resume(): void {
    if (this.running || !this.loop) return;
    this.anchor = this.context.currentTime;
    this.index = 0;
    this.running = true;
    this.clock.start(() => this.tick(), this.intervalMs);
    this.tick();
  }

  private tick(): void {
    if (!this.running || !this.loop) return;
    const horizon = this.context.currentTime + this.lookAheadSeconds;
    for (let guard = 0; guard < MAX_STEPS_PER_TICK; guard++) {
      const loop = this.loop;
      if (this.index < loop.events.length) {
        const event = loop.events[this.index] as ScheduledEvent;
        const time = this.anchor + event.beat * loop.secondsPerBeat;
        if (time > horizon) break;
        if (time >= this.context.currentTime - MAX_LATENESS_SECONDS) {
          event.play(Math.max(time, this.context.currentTime)); // never schedule in the past
        }
        // else: badly overdue (timer stalled) → drop it instead of bursting at "now".
        this.index++;
        continue;
      }
      // This loop's events are all scheduled; advance to the loop boundary when it's within reach.
      const loopEnd = this.anchor + loop.loopBeats * loop.secondsPerBeat;
      if (loopEnd > horizon || loop.loopBeats <= 0) break;
      this.anchor = loopEnd;
      this.loop = this.provider();
      this.index = 0;
    }
  }
}
