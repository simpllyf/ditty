import { describe, expect, it } from "vitest";
import { createPeppyEngine, type EngineOptions } from "../src/index";
import { STINGER_ROOT_MIDI, STINGERS } from "../src/presets";
import { SCALES, degreeToFrequency } from "../src/scale";
import { FakeAudioContext } from "./helpers/fake-audio-context";
import { FakeClock } from "./helpers/fake-clock";

function setup(opts: Partial<EngineOptions> = {}) {
  const ctx = new FakeAudioContext();
  const clock = new FakeClock();
  const engine = createPeppyEngine({ seed: 1234, audioContext: ctx, clock, ...opts });
  return { ctx, clock, engine };
}

/** Advance and tick the scheduler `n` times. */
function run(ctx: FakeAudioContext, clock: FakeClock, n: number): void {
  for (let i = 0; i < n; i++) {
    ctx.advance(0.5);
    clock.tick();
  }
}

const firstFreqs = (ctx: FakeAudioContext) =>
  ctx.oscillators.map((o) => o.frequency.events[0]!.value);

describe("createPeppyEngine — start & playback", () => {
  it("resumes the context and starts producing notes on start()", async () => {
    const { ctx, engine } = setup();
    await engine.start();
    expect(ctx.resumeCount).toBe(1);
    expect(ctx.state).toBe("running");
    expect(ctx.oscillators.length).toBeGreaterThan(0);
  });

  it("does no audio work until start() (safe to construct anywhere)", () => {
    const { ctx } = setup();
    expect(ctx.oscillators).toHaveLength(0);
    expect(ctx.gains).toHaveLength(0);
    expect(ctx.resumeCount).toBe(0);
  });

  it("works with a random seed (no seed given)", async () => {
    const ctx = new FakeAudioContext();
    const clock = new FakeClock();
    const engine = createPeppyEngine({ audioContext: ctx, clock });
    await engine.start();
    expect(ctx.oscillators.length).toBeGreaterThan(0);
  });
});

describe("createPeppyEngine — determinism", () => {
  async function freqsForSeed(seed: number): Promise<number[]> {
    const ctx = new FakeAudioContext();
    const clock = new FakeClock();
    const engine = createPeppyEngine({ seed, audioContext: ctx, clock });
    await engine.start();
    run(ctx, clock, 8);
    return firstFreqs(ctx);
  }

  it("same seed → identical scheduled pitches", async () => {
    expect(await freqsForSeed(2024)).toEqual(await freqsForSeed(2024));
  });

  it("different seeds → different music", async () => {
    expect(await freqsForSeed(1)).not.toEqual(await freqsForSeed(2));
  });
});

describe("createPeppyEngine — stinger", () => {
  it("layers a flourish over the bed without stopping the scheduler", async () => {
    const { ctx, clock, engine } = setup();
    await engine.start();
    run(ctx, clock, 2);
    const before = ctx.oscillators.length;

    engine.stinger("correct");
    const added = ctx.oscillators.slice(before);
    expect(added).toHaveLength(3); // "correct" is a 3-note arpeggio
    expect(added.map((o) => o.frequency.events[0]!.value)).toEqual(
      [0, 2, 4].map((d) => degreeToFrequency(SCALES.majorPentatonic, d, STINGER_ROOT_MIDI)),
    );

    // The bed keeps going — over the next bar it schedules many more notes.
    run(ctx, clock, 4);
    expect(ctx.oscillators.length).toBeGreaterThan(before + 3);
  });

  it("is a no-op before start()", () => {
    const { ctx, engine } = setup();
    engine.stinger("win");
    expect(ctx.oscillators).toHaveLength(0);
  });

  it("plays levelup and win with the right note counts and voices", async () => {
    const { ctx, engine } = setup();
    await engine.start();

    let before = ctx.oscillators.length;
    engine.stinger("levelup");
    const levelup = ctx.oscillators.slice(before);
    expect(levelup).toHaveLength(5);
    expect(levelup.every((o) => o.type === "square")).toBe(true); // all arp voice

    before = ctx.oscillators.length;
    engine.stinger("win");
    const win = ctx.oscillators.slice(before);
    expect(win).toHaveLength(6);
    expect(win.filter((o) => o.type === "triangle")).toHaveLength(1); // the bass body note
    expect(win.filter((o) => o.type === "square")).toHaveLength(5); // the arpeggio
  });

  it("schedules stinger notes at their offsets from the trigger time", async () => {
    const { ctx, engine } = setup();
    await engine.start();
    ctx.advance(1.234);
    const before = ctx.oscillators.length;
    engine.stinger("correct");
    const added = ctx.oscillators.slice(before);
    for (let i = 0; i < added.length; i++) {
      expect(added[i]!.startedAt).toBeCloseTo(1.234 + STINGERS.correct[i]!.timeOffset, 9);
    }
  });
});

describe("createPeppyEngine — volume", () => {
  it("sets the master volume after start", async () => {
    const { ctx, engine } = setup();
    await engine.start();
    engine.setVolume(0.2);
    expect(ctx.gains[0]!.gain.value).toBe(0.2); // gains[0] is the synth master
  });

  it("remembers a volume set before start and applies it to the graph", async () => {
    const ctx = new FakeAudioContext();
    const clock = new FakeClock();
    const engine = createPeppyEngine({ seed: 1, audioContext: ctx, clock, volume: 0.5 });
    engine.setVolume(0.1);
    await engine.start();
    expect(ctx.gains[0]!.gain.value).toBe(0.1);
  });

  it("clamps volume, including non-finite values (NaN must not corrupt the gain)", async () => {
    const { ctx, engine } = setup();
    await engine.start();
    engine.setVolume(2);
    expect(ctx.gains[0]!.gain.value).toBe(1);
    engine.setVolume(-1);
    expect(ctx.gains[0]!.gain.value).toBe(0);
    engine.setVolume(Number.NaN);
    expect(ctx.gains[0]!.gain.value).toBe(0); // safe fallback, not NaN
  });
});

describe("createPeppyEngine — lifecycle robustness", () => {
  it("creates and closes its OWN context when none is injected", async () => {
    const created: FakeAudioContext[] = [];
    class StubContext extends FakeAudioContext {
      constructor() {
        super();
        created.push(this);
      }
    }
    const g = globalThis as { AudioContext?: unknown };
    const original = g.AudioContext;
    g.AudioContext = StubContext;
    try {
      const engine = createPeppyEngine({ seed: 1, clock: new FakeClock() }); // no audioContext → owns it
      await engine.start();
      expect(created).toHaveLength(1);
      expect(created[0]!.oscillators.length).toBeGreaterThan(0);
      engine.dispose();
      expect(created[0]!.closeCount).toBe(1); // an owned context IS closed
    } finally {
      g.AudioContext = original;
    }
  });

  it("can be restarted after stop()", async () => {
    const { ctx, clock, engine } = setup();
    await engine.start();
    run(ctx, clock, 1);
    engine.stop();
    const n = ctx.oscillators.length;

    await engine.start();
    expect(ctx.resumeCount).toBe(2);
    run(ctx, clock, 1);
    expect(ctx.oscillators.length).toBeGreaterThan(n);
  });

  it("dispose is idempotent", async () => {
    const { ctx, engine } = setup();
    await engine.start();
    engine.dispose();
    engine.dispose();
    expect(ctx.gains[0]!.disconnectCount).toBe(1); // no double-disconnect
  });

  it("rejects an invalid tempo at construction (fail fast)", () => {
    for (const tempo of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createPeppyEngine({ tempo })).toThrow(RangeError);
    }
  });

  it("tempo changes note density", async () => {
    async function noteCount(tempo: number): Promise<number> {
      const ctx = new FakeAudioContext();
      const clock = new FakeClock();
      const engine = createPeppyEngine({ seed: 7, audioContext: ctx, clock, tempo });
      await engine.start();
      run(ctx, clock, 4);
      return ctx.oscillators.length;
    }
    expect(await noteCount(240)).toBeGreaterThan(await noteCount(60));
  });

  it("does not leak unhandled rejections when context lifecycle calls fail", async () => {
    const { ctx, engine } = setup();
    await engine.start();
    ctx.failSuspend = true;
    ctx.failResume = true;
    engine.pause();
    engine.resume();
    await Promise.resolve(); // flush microtasks; an uncaught rejection would fail the test
    expect(ctx.suspendCount).toBeGreaterThan(0);
  });

  it("does not start the scheduler if disposed during start()'s async gap", async () => {
    const ctx = new FakeAudioContext();
    const clock = new FakeClock();
    ctx.deferResume = true;
    const engine = createPeppyEngine({ seed: 1, audioContext: ctx, clock });

    const starting = engine.start(); // suspends at `await context.resume()`
    engine.dispose(); // disposed mid-gap
    ctx.flushResume(); // resume resolves; start() must now bail out
    await starting;

    expect(clock.startCount).toBe(0); // scheduler.start() was correctly skipped
  });
});

describe("createPeppyEngine — pause / resume / stop", () => {
  it("pause suspends the context and stops scheduling", async () => {
    const { ctx, clock, engine } = setup();
    await engine.start();
    run(ctx, clock, 1);
    const n = ctx.oscillators.length;

    engine.pause();
    expect(ctx.suspendCount).toBe(1);
    run(ctx, clock, 1); // a stray tick while paused must schedule nothing
    expect(ctx.oscillators.length).toBe(n);
  });

  it("resume continues playback", async () => {
    const { ctx, engine } = setup();
    await engine.start();
    engine.pause();
    const n = ctx.oscillators.length;
    engine.resume();
    expect(ctx.resumeCount).toBeGreaterThanOrEqual(2);
    expect(ctx.oscillators.length).toBeGreaterThan(n); // re-anchored and scheduling again
  });

  it("stop halts scheduling (and leaves the context for a later start)", async () => {
    const { ctx, clock, engine } = setup();
    await engine.start();
    run(ctx, clock, 1);
    const n = ctx.oscillators.length;
    engine.stop();
    run(ctx, clock, 2);
    expect(ctx.oscillators.length).toBe(n);
    expect(ctx.closeCount).toBe(0); // not disposed
  });
});

describe("createPeppyEngine — dispose", () => {
  it("releases the synth, leaves an injected context open, and is inert afterward", async () => {
    const { ctx, engine } = setup();
    await engine.start();
    engine.dispose();

    expect(ctx.gains[0]!.disconnectCount).toBe(1); // master released
    expect(ctx.closeCount).toBe(0); // the caller owns an injected context
    await engine.start(); // no-op after dispose
    expect(ctx.resumeCount).toBe(1); // unchanged
  });
});
