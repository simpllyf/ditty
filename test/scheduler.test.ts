import { describe, expect, it } from "vitest";
import { type PreparedLoop, Scheduler, type SchedulerClock } from "../src/audio/scheduler";
import { FakeAudioContext } from "./helpers/fake-audio-context";
import { FakeClock } from "./helpers/fake-clock";

class ManualClock implements SchedulerClock {
  private cb: (() => void) | null = null;
  start(cb: () => void): void {
    this.cb = cb;
  }
  stop(): void {
    this.cb = null;
  }
  tick(): void {
    this.cb?.();
  }
}

function loopOf(played: { beat: number; time: number }[]): PreparedLoop {
  const mk = (beat: number) => ({ beat, play: (time: number) => played.push({ beat, time }) });
  return { events: [mk(0), mk(2)], loopBeats: 4, secondsPerBeat: 0.5 };
}

describe("Scheduler", () => {
  it("schedules only within the look-ahead window, then loops at the boundary", () => {
    const ctx = new FakeAudioContext();
    const played: { beat: number; time: number }[] = [];
    const clock = new ManualClock();
    const sch = new Scheduler({
      context: ctx,
      provider: () => loopOf(played),
      lookAheadSeconds: 0.1,
      clock,
    });

    sch.start(); // t=0, horizon 0.1 → only beat 0 (beat 2 is at t=1.0)
    expect(played.map((p) => p.beat)).toEqual([0]);

    ctx.advance(1); // t=1, horizon 1.1 → beat 2 (t=1.0)
    clock.tick();
    expect(played.map((p) => p.beat)).toEqual([0, 2]);

    ctx.advance(1.1); // t=2.1, horizon 2.2 → loop boundary at 2.0 → next loop's beat 0
    clock.tick();
    expect(played.filter((p) => p.beat === 0).length).toBe(2);
  });

  it("never schedules in the past (late timer clamps to now)", () => {
    const ctx = new FakeAudioContext();
    const played: { beat: number; time: number }[] = [];
    const clock = new ManualClock();
    const sch = new Scheduler({ context: ctx, provider: () => loopOf(played), clock });
    ctx.advance(5); // start late
    sch.start();
    expect(played[0]!.time).toBeGreaterThanOrEqual(5);
  });

  it("re-invokes the provider each loop, playing the new loop's events (the evolve seam)", () => {
    const ctx = new FakeAudioContext();
    const played: number[] = [];
    let n = 0;
    const provider = () => {
      const id = n++;
      return {
        events: [{ beat: 0, play: () => played.push(id) }],
        loopBeats: 2,
        secondsPerBeat: 0.5,
      };
    };
    const clock = new ManualClock();
    const sch = new Scheduler({ context: ctx, provider, lookAheadSeconds: 0.1, clock });
    sch.start(); // loop 0
    ctx.advance(1.1); // past the loop boundary at t=1.0
    clock.tick();
    expect(played).toEqual([0, 1]); // distinct loops → provider was called again
  });

  it("does not spin on a degenerate loopBeats <= 0", () => {
    const ctx = new FakeAudioContext();
    let calls = 0;
    const provider = () => {
      calls++;
      return { events: [], loopBeats: 0, secondsPerBeat: 0.5 };
    };
    const clock = new ManualClock();
    const sch = new Scheduler({ context: ctx, provider, clock });
    sch.start();
    ctx.advance(10);
    clock.tick();
    expect(calls).toBeLessThan(5); // the guard prevents a runaway re-arrange loop
  });

  it("drops badly-overdue events on a timer stall instead of bursting at 'now'", () => {
    const ctx = new FakeAudioContext();
    const played: { beat: number; time: number }[] = [];
    const clock = new ManualClock();
    const provider = () => ({
      events: [0, 1, 2, 3].map((beat) => ({
        beat,
        play: (time: number) => played.push({ beat, time }),
      })),
      loopBeats: 4,
      secondsPerBeat: 0.5, // event times 0,0.5,1,1.5; loop = 2 s
    });
    const sch = new Scheduler({ context: ctx, provider, lookAheadSeconds: 0.1, clock });
    sch.start(); // plays beat 0 at t=0
    ctx.advance(10); // a long stall: the audio clock ran on while the timer slept
    clock.tick();
    // The whole backlog must NOT collapse onto t=10 — at most the one currently-due event.
    expect(played.filter((p) => p.time === 10).length).toBeLessThanOrEqual(2);
    expect(played.every((p) => p.time <= 10)).toBe(true);
  });

  it("pause keeps position; resume continues without re-arranging", () => {
    const ctx = new FakeAudioContext();
    let providerCalls = 0;
    const provider = () => {
      providerCalls++;
      return { events: [{ beat: 0, play: () => {} }], loopBeats: 4, secondsPerBeat: 0.5 };
    };
    const sch = new Scheduler({ context: ctx, provider, clock: new ManualClock() });
    sch.start();
    expect(providerCalls).toBe(1);
    sch.pause();
    expect(sch.isRunning).toBe(false);
    sch.resume();
    expect(sch.isRunning).toBe(true);
    expect(providerCalls).toBe(1); // resumed the same loop — no fresh arrangement (unlike start())
  });

  it("stop() after pause() fully resets, so a later resume() is a no-op", () => {
    const ctx = new FakeAudioContext();
    let providerCalls = 0;
    const provider = () => {
      providerCalls++;
      return { events: [{ beat: 0, play: () => {} }], loopBeats: 4, secondsPerBeat: 0.5 };
    };
    const sch = new Scheduler({ context: ctx, provider, clock: new ManualClock() });
    sch.start();
    sch.pause();
    sch.stop(); // must clear position even from the paused state
    sch.resume(); // no-op: there is no kept loop to resume
    expect(sch.isRunning).toBe(false);
    expect(providerCalls).toBe(1); // resume did not restart from a stale position
  });

  it("resume is a no-op before start()", () => {
    const ctx = new FakeAudioContext();
    const sch = new Scheduler({
      context: ctx,
      provider: () => loopOf([]),
      clock: new ManualClock(),
    });
    sch.resume();
    expect(sch.isRunning).toBe(false);
  });

  it("ignores a stray timer fire after stop (running guard)", () => {
    const ctx = new FakeAudioContext();
    const played: { beat: number; time: number }[] = [];
    const clock = new FakeClock(); // retains the callback after stop() on purpose
    const sch = new Scheduler({ context: ctx, provider: () => loopOf(played), clock });
    sch.start();
    const count = played.length;
    sch.stop();
    ctx.advance(10);
    clock.tick(); // a stray fire after stop
    expect(played.length).toBe(count); // the running guard prevented any scheduling
    expect(clock.stopCount).toBeGreaterThan(0);
  });

  it("stop() halts scheduling; start() is idempotent", () => {
    const ctx = new FakeAudioContext();
    const played: { beat: number; time: number }[] = [];
    const clock = new ManualClock();
    const sch = new Scheduler({ context: ctx, provider: () => loopOf(played), clock });
    sch.start();
    sch.start(); // idempotent
    expect(sch.isRunning).toBe(true);
    sch.stop();
    expect(sch.isRunning).toBe(false);
    const count = played.length;
    ctx.advance(10);
    clock.tick(); // no callback registered after stop
    expect(played.length).toBe(count);
  });
});
