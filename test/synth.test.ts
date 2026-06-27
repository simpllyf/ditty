import { beforeEach, describe, expect, it } from "vitest";
import { type ScheduledNote, Synth } from "../src/synth";
import { FakeAudioContext } from "./helpers/fake-audio-context";

function note(overrides: Partial<ScheduledNote> = {}): ScheduledNote {
  return {
    voice: "lead",
    frequency: 440,
    startTime: 10,
    durationSeconds: 1,
    velocity: 1,
    ...overrides,
  };
}

let ctx: FakeAudioContext;

beforeEach(() => {
  ctx = new FakeAudioContext();
});

describe("Synth — wiring", () => {
  it("creates a master gain at the requested volume and connects it to the destination", () => {
    const synth = new Synth(ctx, { volume: 0.3 });
    expect(ctx.gains).toHaveLength(1); // the master
    const master = ctx.gains[0]!;
    expect(master.gain.value).toBe(0.3);
    expect(master.gain.events.at(-1)).toMatchObject({ type: "set", value: 0.3 });
    expect(master.connectedTo).toContain(ctx.destination);
    expect(synth.volume).toBe(0.3);
  });

  it("defaults the volume to 0.4 and clamps out-of-range volume", () => {
    expect(new Synth(ctx).volume).toBe(0.4);
    const synth = new Synth(ctx);
    synth.setVolume(5);
    expect(synth.volume).toBe(1);
    synth.setVolume(-1);
    expect(synth.volume).toBe(0);
  });

  it("setVolume schedules the new value on the master gain at the current time", () => {
    const synth = new Synth(ctx);
    ctx.advance(3);
    synth.setVolume(0.7);
    expect(ctx.gains[0]!.gain.events.at(-1)).toEqual({ type: "set", value: 0.7, time: 3 });
  });

  it("setVolume is a no-op after dispose", () => {
    const synth = new Synth(ctx);
    synth.dispose();
    const eventsBefore = ctx.gains[0]!.gain.events.length;
    synth.setVolume(0.9);
    expect(synth.volume).toBe(0.4); // unchanged
    expect(ctx.gains[0]!.gain.events).toHaveLength(eventsBefore); // no new automation
  });
});

describe("Synth — play()", () => {
  it("routes oscillator → envelope → master and schedules the frequency", () => {
    const synth = new Synth(ctx);
    synth.play(note({ frequency: 523.25, startTime: 10 }));

    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.gains).toHaveLength(2); // master + this note's envelope
    const osc = ctx.oscillators[0]!;
    const env = ctx.gains[1]!;
    const master = ctx.gains[0]!;

    expect(osc.connectedTo).toContain(env);
    expect(env.connectedTo).toContain(master);
    expect(osc.frequency.events).toContainEqual({ type: "set", value: 523.25, time: 10 });
  });

  it("applies the lead timbre and a snappy ADSR envelope", () => {
    const synth = new Synth(ctx);
    synth.play(note({ startTime: 10, durationSeconds: 1, velocity: 1 })); // lead, peak 0.5

    const osc = ctx.oscillators[0]!;
    const env = ctx.gains[1]!;
    expect(osc.type).toBe("square");

    const e = env.gain.events;
    expect(e[0]).toMatchObject({ type: "set", value: 0 }); // start at silence
    expect(e[0]!.time).toBeCloseTo(10, 9);
    expect(e[1]).toMatchObject({ type: "linramp", value: 0.5 }); // attack to peak
    expect(e[1]!.time).toBeCloseTo(10.005, 9);
    expect(e[2]).toMatchObject({ type: "linramp", value: 0.25 }); // decay to sustain (0.5 * 0.5)
    expect(e[2]!.time).toBeCloseTo(10.065, 9);
    expect(e[3]).toMatchObject({ type: "set", value: 0.25 }); // hold until release
    expect(e[3]!.time).toBeCloseTo(11, 9);
    expect(e[4]).toMatchObject({ type: "linramp", value: 0 }); // release to silence
    expect(e[4]!.time).toBeCloseTo(11.08, 9);

    expect(osc.startedAt).toBeCloseTo(10, 9);
    expect(osc.stoppedAt).toBeCloseTo(11.1, 9); // releaseStart + release + tail
  });

  it("gives each voice its own timbre and envelope", () => {
    const synth = new Synth(ctx);
    synth.play(note({ voice: "bass", startTime: 0, durationSeconds: 1, velocity: 1 }));
    synth.play(note({ voice: "arp", startTime: 0, durationSeconds: 1, velocity: 1 }));

    const bassOsc = ctx.oscillators[0]!;
    const bassEnv = ctx.gains[1]!;
    expect(bassOsc.type).toBe("triangle");
    // bass: gain 0.6, sustain 0.6, attack 0.005
    expect(bassEnv.gain.events[1]).toMatchObject({ type: "linramp", value: 0.6 }); // peak
    expect(bassEnv.gain.events[1]!.time).toBeCloseTo(0.005, 9);
    expect(bassEnv.gain.events[2]!.value).toBeCloseTo(0.36, 9); // sustain = 0.6 * 0.6

    const arpOsc = ctx.oscillators[1]!;
    const arpEnv = ctx.gains[2]!;
    expect(arpOsc.type).toBe("square");
    // arp: gain 0.35, sustain 0.3
    expect(arpEnv.gain.events[1]).toMatchObject({ type: "linramp", value: 0.35 }); // peak
    expect(arpEnv.gain.events[2]!.value).toBeCloseTo(0.105, 9); // sustain = 0.35 * 0.3
  });

  it("scales the envelope peak by velocity, clamped to 0..1", () => {
    const synth = new Synth(ctx);
    synth.play(note({ velocity: 0.4 })); // lead peak = 0.4 * 0.5 = 0.2
    expect(ctx.gains[1]!.gain.events[1]!.value).toBeCloseTo(0.2, 9);
    synth.play(note({ velocity: 2 })); // clamped to 1 → peak = 0.5, not 1.0
    expect(ctx.gains[2]!.gain.events[1]!.value).toBeCloseTo(0.5, 9);
    synth.play(note({ velocity: -1 })); // clamped to 0 → peak = 0
    expect(ctx.gains[3]!.gain.events[1]!.value).toBeCloseTo(0, 9);
  });

  it("clamps the release point for notes shorter than attack+decay", () => {
    const synth = new Synth(ctx);
    synth.play(note({ startTime: 10, durationSeconds: 0.001 })); // shorter than 0.065
    const e = ctx.gains[1]!.gain.events;
    // releaseStart must be the attack+decay end (10.065), not 10.001.
    expect(e[3]!.time).toBeCloseTo(10.065, 9);
  });

  it("does nothing after dispose()", () => {
    const synth = new Synth(ctx);
    synth.dispose();
    synth.play(note());
    expect(ctx.oscillators).toHaveLength(0);
  });
});

describe("Synth — voice pool", () => {
  it("steals the oldest voice when the cap is exceeded", () => {
    const synth = new Synth(ctx, { maxVoices: 2 });
    synth.play(note({ startTime: 0, durationSeconds: 100 }));
    synth.play(note({ startTime: 0, durationSeconds: 100 }));
    synth.play(note({ startTime: 0, durationSeconds: 100 })); // exceeds cap → steal #0

    expect(ctx.oscillators).toHaveLength(3);
    // The stolen voice was stopped at the current time (0), not its scheduled end.
    expect(ctx.oscillators[0]!.stoppedAt).toBe(0);
    expect(ctx.oscillators[0]!.disconnectCount).toBe(1);
    // The survivors are untouched.
    expect(ctx.oscillators[1]!.disconnectCount).toBe(0);
  });

  it("stays bounded to maxVoices, stealing oldest-first over repeated overflow", () => {
    const synth = new Synth(ctx, { maxVoices: 2 });
    for (let i = 0; i < 5; i++) synth.play(note({ startTime: 0, durationSeconds: 100 }));
    ctx.advance(5);
    synth.silenceAll(); // only the survivors are still active at this point

    const stolen = ctx.oscillators.filter((o) => o.stoppedAt === 0); // cut at steal time
    const survivors = ctx.oscillators.filter((o) => o.stoppedAt === 5); // cut by silenceAll
    expect(stolen).toHaveLength(3); // the three oldest were stolen
    expect(survivors).toHaveLength(2); // active set never exceeded maxVoices
    for (const o of ctx.oscillators) expect(o.disconnectCount).toBe(1); // none leaked
  });

  it("sweeps finished voices on the next play()", () => {
    const synth = new Synth(ctx);
    synth.play(note({ startTime: 0, durationSeconds: 0.1 }));
    const finished = ctx.oscillators[0]!;
    ctx.advance(10); // well past the note's end
    synth.play(note({ startTime: 10, durationSeconds: 0.1 }));
    expect(finished.disconnectCount).toBe(1); // cleaned up
  });
});

describe("Synth — silence & dispose", () => {
  it("silenceAll stops and disconnects every active voice", () => {
    const synth = new Synth(ctx);
    synth.play(note({ startTime: 0, durationSeconds: 100 }));
    synth.play(note({ startTime: 0, durationSeconds: 100 }));
    ctx.advance(1);
    synth.silenceAll();
    for (const osc of ctx.oscillators) {
      expect(osc.stoppedAt).toBe(1);
      expect(osc.disconnectCount).toBe(1);
    }
    expect(ctx.gains[0]!.disconnectCount).toBe(0); // master is never swept/silenced
  });

  it("dispose silences voices and releases the master node, and is idempotent", () => {
    const synth = new Synth(ctx);
    synth.play(note({ startTime: 0, durationSeconds: 100 }));
    synth.dispose();
    expect(ctx.gains[0]!.disconnectCount).toBe(1); // master released
    expect(ctx.oscillators[0]!.disconnectCount).toBe(1); // voice silenced
    synth.dispose(); // no throw, no double-disconnect
    expect(ctx.gains[0]!.disconnectCount).toBe(1);
  });
});
