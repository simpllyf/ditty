import { describe, expect, it } from "vitest";
import { type PreparedLoop, Scheduler, type SchedulerClock } from "../src/scheduler";
import { FakeAudioContext } from "./helpers/fake-audio-context";

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
