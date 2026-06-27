import { describe, expect, it } from "vitest";
import type { NoteEvent } from "../src/melody";
import { type NoteStream, Scheduler, type SchedulerOptions } from "../src/scheduler";
import type { ScheduledNote } from "../src/synth";
import { FakeAudioContext } from "./helpers/fake-audio-context";
import { FakeClock } from "./helpers/fake-clock";

/** A stream that emits a bar of four 1-beat lead notes per call, beats counting up. */
class FakeStream implements NoteStream {
  nextCount = 0;
  private bar = 0;

  next(): NoteEvent[] {
    this.nextCount++;
    const base = this.bar * 4;
    this.bar++;
    return [0, 1, 2, 3].map((i) => ({
      startBeat: base + i,
      durationBeats: 1,
      frequency: 440,
      velocity: 0.7,
      voice: "lead" as const,
    }));
  }
}

function setup(opts: Partial<SchedulerOptions> = {}) {
  const ctx = new FakeAudioContext();
  const clock = new FakeClock();
  const stream = new FakeStream();
  const plays: ScheduledNote[] = [];
  const scheduler = new Scheduler({
    stream,
    synth: { play: (note) => plays.push(note) },
    context: ctx,
    tempo: 120, // secondsPerBeat = 0.5
    lookAheadSeconds: 0.1,
    intervalMs: 25,
    clock,
    ...opts,
  });
  return { ctx, clock, stream, plays, scheduler };
}

describe("Scheduler — start/stop", () => {
  it("starts the timer, anchors to currentTime, and schedules the first window immediately", () => {
    const { ctx, clock, plays, scheduler } = setup();
    ctx.currentTime = 10;
    scheduler.start();

    expect(scheduler.isRunning).toBe(true);
    expect(clock.startCount).toBe(1);
    expect(clock.intervalMs).toBe(25);
    // Only beat 0 (time 10) is within the 0.1s look-ahead; beat 1 is at 10.5.
    expect(plays).toHaveLength(1);
    expect(plays[0]).toMatchObject({
      voice: "lead",
      frequency: 440,
      velocity: 0.7,
      durationSeconds: 0.5,
      startTime: 10,
    });
  });

  it("is idempotent — a second start() does not restart the timer", () => {
    const { clock, scheduler } = setup();
    scheduler.start();
    scheduler.start();
    expect(clock.startCount).toBe(1);
  });

  it("stop() halts the timer and schedules nothing further", () => {
    const { ctx, clock, plays, scheduler } = setup();
    scheduler.start();
    const scheduledSoFar = plays.length;
    scheduler.stop();

    expect(scheduler.isRunning).toBe(false);
    expect(clock.stopCount).toBe(1);
    ctx.advance(10);
    clock.tick(); // a stray timer fire after stop must be inert
    expect(plays).toHaveLength(scheduledSoFar);
  });
});

describe("Scheduler — look-ahead & beat→time", () => {
  it("schedules each beat at startTime + beat * secondsPerBeat", () => {
    const { plays, scheduler } = setup({ lookAheadSeconds: 2 });
    scheduler.start(); // currentTime 0 → schedule every beat with time <= 2
    expect(plays.map((p) => p.startTime)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(plays.every((p) => p.durationSeconds === 0.5)).toBe(true);
  });

  it("only schedules within the look-ahead window, extending it as the clock advances", () => {
    const { ctx, clock, plays, scheduler } = setup({ lookAheadSeconds: 0.1 });
    scheduler.start(); // beat 0 only
    expect(plays).toHaveLength(1);

    ctx.advance(0.5); // now 0.5 → horizon 0.6 → beat 1 (time 0.5) becomes due
    clock.tick();
    expect(plays.map((p) => p.startTime)).toEqual([0, 0.5]);
  });

  it("refills the buffer from the stream to cover the horizon (more than one bar)", () => {
    const { stream, plays, scheduler } = setup({ lookAheadSeconds: 3 });
    scheduler.start();
    // horizon 3 needs beats up to time 3 (beat 6); that spans two bars.
    expect(stream.nextCount).toBe(2);
    expect(plays.map((p) => p.startTime)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
  });

  it("never schedules in the past — late events clamp to the current time", () => {
    const { ctx, clock, plays, scheduler } = setup({ lookAheadSeconds: 0.1 });
    scheduler.start(); // beat 0 at time 0
    ctx.advance(5); // the timer ran very late
    clock.tick();
    // Every newly-due beat (raw time 0.5..5) is clamped to now (5).
    const late = plays.slice(1);
    expect(late.length).toBeGreaterThan(0);
    expect(late.every((p) => p.startTime === 5)).toBe(true);
  });
});

describe("Scheduler — restart re-anchors timing", () => {
  it("maps the first event after a restart to the new currentTime", () => {
    const { ctx, plays, scheduler } = setup({ lookAheadSeconds: 0.1 });
    ctx.currentTime = 0;
    scheduler.start();
    scheduler.stop();

    plays.length = 0;
    ctx.currentTime = 100;
    scheduler.start();
    // The stream has advanced (later beats), but timing re-anchors to 100 —
    // not 100 + (largeBeat * secondsPerBeat).
    expect(plays[0]!.startTime).toBe(100);
  });

  it("scales the beat offset under a non-zero anchor (startTime != 0, firstBeat != 0)", () => {
    const { ctx, plays, scheduler } = setup({ lookAheadSeconds: 2 });
    scheduler.start(); // consumes the first bars, advancing the stream
    scheduler.stop();
    plays.length = 0;

    ctx.currentTime = 100;
    scheduler.start();
    // First post-restart bar maps beat firstBeat→100, then +0.5 per beat.
    expect(plays.slice(0, 4).map((p) => p.startTime)).toEqual([100, 100.5, 101, 101.5]);
  });
});

describe("Scheduler — sustained run", () => {
  it("drains the stream contiguously over many ticks — every beat once, in order", () => {
    const { ctx, clock, plays, scheduler } = setup({ lookAheadSeconds: 0.1 });
    scheduler.start(); // beat 0 at t=0
    for (let i = 1; i <= 12; i++) {
      ctx.advance(0.5);
      clock.tick();
    }
    // Beats 0..12 at 0, 0.5, ..., 6.0 — no gaps, no duplicates, no drift.
    expect(plays.map((p) => p.startTime)).toEqual(Array.from({ length: 13 }, (_, i) => i * 0.5));
  });

  it("passes each event's fields through and scales duration by tempo", () => {
    // An infinite stream of two distinct notes per bar (beats counting up).
    let bar = 0;
    const stream: NoteStream = {
      next() {
        const base = bar * 2;
        bar++;
        return [
          { startBeat: base, durationBeats: 2, frequency: 261.6, velocity: 0.5, voice: "bass" },
          { startBeat: base + 1, durationBeats: 1, frequency: 880, velocity: 0.3, voice: "arp" },
        ];
      },
    };
    const ctx = new FakeAudioContext();
    const clock = new FakeClock();
    const plays: ScheduledNote[] = [];
    new Scheduler({
      stream,
      synth: { play: (n) => plays.push(n) },
      context: ctx,
      tempo: 120,
      lookAheadSeconds: 0.6,
      clock,
    }).start();

    expect(plays[0]).toEqual({
      voice: "bass",
      frequency: 261.6,
      velocity: 0.5,
      startTime: 0,
      durationSeconds: 1, // 2 beats * 0.5
    });
    expect(plays[1]).toEqual({
      voice: "arp",
      frequency: 880,
      velocity: 0.3,
      startTime: 0.5,
      durationSeconds: 0.5,
    });
  });
});

describe("Scheduler — defaults & exhaustion", () => {
  it("applies the default tempo (128), look-ahead (0.1s), and interval (25ms)", () => {
    const ctx = new FakeAudioContext();
    const clock = new FakeClock();
    const plays: ScheduledNote[] = [];
    new Scheduler({
      stream: new FakeStream(),
      synth: { play: (n) => plays.push(n) },
      context: ctx,
      clock,
    }).start();

    expect(clock.intervalMs).toBe(25);
    expect(plays).toHaveLength(1); // 128 BPM → beat 1 at 0.469s is outside the 0.1s window
    expect(plays[0]!.durationSeconds).toBeCloseTo(60 / 128, 9);
  });

  it("schedules nothing and does not hang when the stream is exhausted (empty bars)", () => {
    const ctx = new FakeAudioContext();
    const clock = new FakeClock();
    const plays: ScheduledNote[] = [];
    const scheduler = new Scheduler({
      stream: { next: () => [] },
      synth: { play: (n) => plays.push(n) },
      context: ctx,
      tempo: 120,
      clock,
    });
    scheduler.start();
    ctx.advance(1);
    clock.tick();
    expect(plays).toHaveLength(0);
  });
});

describe("Scheduler — validation", () => {
  it("rejects a non-positive or non-finite tempo", () => {
    for (const tempo of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => setup({ tempo })).toThrow(RangeError);
    }
  });
});
