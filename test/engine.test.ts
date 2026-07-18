import { describe, expect, it, vi } from "vitest";
import { createEngine } from "../src/audio/engine";
import type { SchedulerClock } from "../src/audio/scheduler";
import { createSession } from "../src/session";
import { FakeAudioContext } from "./helpers/fake-audio-context";

class TickClock implements SchedulerClock {
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

const setup = (opts: Record<string, unknown> = {}) => {
  const ctx = new FakeAudioContext();
  const clock = new TickClock();
  const engine = createEngine({ seed: 1, audioContext: ctx, clock, ...opts });
  return { ctx, clock, engine };
};

// Drive the scheduler across `seconds` of audio time. Step by the look-ahead
// interval so every note is scheduled just before its time (no past-clamp), which
// keeps each oscillator's startedAt exact for per-loop bucketing.
function runLoops(ctx: FakeAudioContext, clock: TickClock, seconds: number): void {
  const steps = Math.round(seconds / 0.1);
  for (let i = 0; i < steps; i++) {
    ctx.advance(0.1);
    clock.tick();
  }
}

describe("createEngine", () => {
  it("does no audio work until start() (SSR-safe construction)", () => {
    const { ctx, engine } = setup();
    expect(ctx.oscillators.length).toBe(0);
    expect(ctx.state).toBe("suspended");
    expect(engine).toBeDefined();
  });

  it("resumes the context and schedules notes on start()", async () => {
    const { ctx, engine } = setup({ bpm: 120 });
    await engine.start();
    expect(ctx.state).toBe("running");
    expect(ctx.oscillators.length).toBeGreaterThan(0);
  });

  it("produces the same pitches for the same seed, different across seeds", async () => {
    const pitches = async (seed: number) => {
      const { ctx, engine } = setup({ seed, evolve: false });
      await engine.start();
      return ctx.oscillators.map((o) => o.frequency.value);
    };
    expect(await pitches(7)).toEqual(await pitches(7));
    expect(await pitches(1)).not.toEqual(await pitches(2));
  });

  it("evolve:true re-arranges each loop while keeping instruments stable", async () => {
    const { ctx, clock, engine } = setup({ seed: 3, bpm: 120, bars: 8, evolve: true });
    await engine.start();
    runLoops(ctx, clock, 34); // bars 8 × 4 beats × 0.5 s = 16 s per loop → cross several
    const loopSec = 16;
    const inLoop = (lo: number, hi: number) =>
      ctx.oscillators.filter((o) => o.startedAt! >= lo && o.startedAt! < hi);
    const loop1 = inLoop(0, loopSec);
    const loop2 = inLoop(loopSec, loopSec * 2);
    expect(loop2.length).toBeGreaterThan(0);
    // Notes change across loops...
    expect(loop2.map((o) => o.frequency.value)).not.toEqual(loop1.map((o) => o.frequency.value));
    // ...but the instrument set (oscillator waveforms) stays the same.
    const kinds = (oscs: typeof loop1) => [...new Set(oscs.map((o) => o.type))].sort();
    expect(kinds(loop2)).toEqual(kinds(loop1));
  });

  it("evolve:false loops the form (periodic); evolve:true keeps changing", async () => {
    const opts = { seed: 3, bpm: 120, bars: 8 };
    const windows = 12; // ≥ 2 full forms (max template length is 6)
    // Sections carry their own tempo → loops have different lengths; bucket by the
    // ACTUAL cumulative loop boundaries rather than a constant stride.
    const bounds = [0];
    const probe = createSession(opts);
    for (let i = 0; i < windows; i++) {
      const sc = probe.nextScore();
      bounds.push(bounds[bounds.length - 1]! + sc.lengthBeats * (60 / sc.bpm));
    }
    const distinctLoops = async (evolve: boolean) => {
      const { ctx, clock, engine } = setup({ ...opts, evolve });
      await engine.start();
      runLoops(ctx, clock, bounds[windows]! + 1);
      const fps = new Set<string>();
      for (let k = 0; k < windows; k++) {
        const f = ctx.oscillators
          .filter((o) => o.startedAt! >= bounds[k]! && o.startedAt! < bounds[k + 1]!)
          .map((o) => o.frequency.value);
        if (f.length) fps.add(JSON.stringify(f));
      }
      return fps.size;
    };
    const repeating = await distinctLoops(false);
    const evolving = await distinctLoops(true);
    // Only the form's sections recur — at most six, plus the one-time opening.
    expect(repeating).toBeLessThanOrEqual(7);
    expect(evolving).toBeGreaterThan(repeating); // melodies re-draw on each pass
  });

  it("ramps the master to silence on pause then back up on resume, suspending only after", async () => {
    const { ctx, engine } = setup({ volume: 0.5 });
    await engine.start();
    const master = ctx.gains[0]!.gain;
    engine.pause();
    expect(master.events.some((e) => e.type === "linramp" && e.value === 0)).toBe(true); // ramp to TRUE 0
    expect(ctx.suspendCount).toBe(0); // suspend deferred well past the fade (freeze lands on silence → no click)
    await new Promise((r) => setTimeout(r, 350));
    expect(ctx.suspendCount).toBe(1);
    engine.resume();
    expect(ctx.resumeCount).toBeGreaterThanOrEqual(2);
    expect(master.events.some((e) => e.type === "linramp" && e.value === 0.5)).toBe(true); // ramped back up
  });

  it("setVolume ramps the master gain", async () => {
    const { ctx, engine } = setup({ volume: 0.3 });
    await engine.start();
    engine.setVolume(0.6);
    expect(ctx.gains[0]!.gain.events.some((e) => e.type === "target" && e.value === 0.6)).toBe(
      true,
    );
  });

  it("dispose does not close an injected context", async () => {
    const { ctx, engine } = setup();
    await engine.start();
    engine.dispose();
    expect(ctx.closeCount).toBe(0);
    await engine.start();
    expect(ctx.state).not.toBe("closed");
  });

  it("closes a context it created on dispose", async () => {
    const fake = new FakeAudioContext();
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          return fake;
        }
      },
    );
    try {
      const engine = createEngine({ seed: 1, clock: new TickClock() }); // no injected ctx → owns it
      await engine.start();
      engine.dispose();
      expect(fake.closeCount).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not start if disposed during the resume await", async () => {
    const ctx = new FakeAudioContext();
    ctx.deferResume = true;
    const engine = createEngine({ seed: 1, audioContext: ctx, clock: new TickClock() });
    const starting = engine.start();
    engine.dispose(); // race: dispose while resume() is pending
    ctx.flushResume();
    await starting;
    expect(ctx.oscillators.length).toBe(0); // scheduler never ran
  });

  it("pause swallows a failing context transition", async () => {
    const ctx = new FakeAudioContext();
    ctx.failSuspend = true;
    const engine = createEngine({ seed: 1, audioContext: ctx, clock: new TickClock() });
    await engine.start();
    expect(() => engine.pause()).not.toThrow();
    await new Promise((r) => setTimeout(r, 350)); // the deferred suspend fires + rejects → swallowed
    engine.dispose();
  });

  it("resume swallows a failing context transition", async () => {
    const ctx = new FakeAudioContext();
    const engine = createEngine({ seed: 1, audioContext: ctx, clock: new TickClock() });
    await engine.start();
    ctx.failResume = true;
    expect(() => engine.resume()).not.toThrow();
    await Promise.resolve(); // let the swallowed rejection settle (no unhandled rejection)
  });

  it("dispose swallows a failing close on a context it owns", async () => {
    const fake = new FakeAudioContext();
    fake.failClose = true;
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          return fake;
        }
      },
    );
    try {
      const engine = createEngine({ seed: 1, clock: new TickClock() }); // owns the context
      await engine.start();
      expect(() => engine.dispose()).not.toThrow();
      await Promise.resolve();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("control methods are safe no-ops before start()", () => {
    const ctx = new FakeAudioContext();
    const engine = createEngine({ seed: 1, audioContext: ctx, clock: new TickClock() });
    expect(() => {
      engine.pause();
      engine.resume();
      engine.stop();
      engine.setVolume(0.5);
      engine.dispose();
    }).not.toThrow();
    expect(ctx.oscillators.length).toBe(0); // nothing scheduled
    expect(ctx.suspendCount).toBe(0); // no graph → no transitions
  });

  it("different styles produce different music for the same seed", async () => {
    const freqs = async (style: "calm" | "playful") => {
      const ctx = new FakeAudioContext();
      const engine = createEngine({ seed: 5, style, audioContext: ctx, clock: new TickClock() });
      await engine.start();
      return ctx.oscillators.map((o) => o.frequency.value);
    };
    expect(await freqs("calm")).not.toEqual(await freqs("playful"));
  });

  it("an explicit bpm overrides the style's tempo", async () => {
    const noteCount = async (bpm: number) => {
      const ctx = new FakeAudioContext();
      const clock = new TickClock();
      const engine = createEngine({ seed: 5, style: "calm", bpm, audioContext: ctx, clock });
      await engine.start();
      runLoops(ctx, clock, 4);
      return ctx.oscillators.length;
    };
    expect(await noteCount(180)).toBeGreaterThan(await noteCount(60)); // faster tempo → more notes
  });

  it("honors an explicit swing:0 over the style (?? not ||, so 0 wins)", async () => {
    // playful's swing range is [0.1, 0.4] → chosen swing > 0; forcing 0 must change timing.
    // No intro: this compares a fixed number of loops, and a half-length opening would
    // shift which sections those loops cover.
    const starts = async (extra: Record<string, unknown>) => {
      const ctx = new FakeAudioContext();
      const clock = new TickClock();
      const engine = createEngine({
        seed: 5,
        style: "playful",
        intro: false,
        audioContext: ctx,
        clock,
        ...extra,
      });
      await engine.start();
      runLoops(ctx, clock, 4);
      return ctx.oscillators.map((o) => o.startedAt);
    };
    expect(await starts({ swing: 0 })).not.toEqual(await starts({}));
  });

  it("honors an explicit density:0 over the style (0 wins → sparser)", async () => {
    // playful's density range is [0.6, 0.9] → forcing 0 yields a sparser lead → fewer notes.
    // No intro: it carries no lead at all, which would blunt the comparison.
    const count = async (extra: Record<string, unknown>) => {
      const ctx = new FakeAudioContext();
      const clock = new TickClock();
      const engine = createEngine({
        seed: 5,
        style: "playful",
        intro: false,
        audioContext: ctx,
        clock,
        ...extra,
      });
      await engine.start();
      runLoops(ctx, clock, 4);
      return ctx.oscillators.length;
    };
    expect(await count({ density: 0 })).toBeLessThan(await count({}));
  });

  it("stop() halts scheduling without closing the context, and is restartable", async () => {
    const { ctx, engine } = setup();
    await engine.start();
    const afterStart = ctx.oscillators.length;
    engine.stop();
    expect(ctx.closeCount).toBe(0); // not torn down
    expect(ctx.state).toBe("running"); // context still alive
    await engine.start(); // restartable
    expect(ctx.oscillators.length).toBeGreaterThanOrEqual(afterStart);
  });

  it("rejects bad config eagerly at construction (bpm, bars, beatsPerBar)", () => {
    expect(() => createEngine({ bpm: 0 })).toThrow(RangeError);
    expect(() => createEngine({ bpm: Number.NaN })).toThrow(RangeError);
    expect(() => createEngine({ bars: 2 })).toThrow(RangeError); // eager, not at first tick
    expect(() => createEngine({ beatsPerBar: 0 })).toThrow(RangeError);
  });
});
