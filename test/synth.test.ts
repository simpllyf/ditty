import { describe, expect, it } from "vitest";
import { DRUM_KITS, INSTRUMENTS, type Instrument } from "../src/instruments";
import { makeNoiseTable } from "../src/noise";
import { makeRng } from "../src/rng";
import { Synth } from "../src/audio/synth";
import { FakeAudioContext } from "./helpers/fake-audio-context";

const noise = makeNoiseTable(makeRng(1), 256);
const make = (ctx: FakeAudioContext) => new Synth(ctx, { noiseTable: noise, masterGain: 0.4 });

describe("Synth.playNote", () => {
  it("creates one oscillator per layer and schedules an ADSR envelope", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    s.playNote(INSTRUMENTS.warmPad, { freq: 220, startTime: 1, durationSeconds: 2, velocity: 0.6 });
    expect(ctx.oscillators.length).toBe(INSTRUMENTS.warmPad.layers.length);
    const osc = ctx.oscillators[0]!;
    expect(osc.startedAt).toBe(1);
    expect(osc.stoppedAt).toBeGreaterThan(3); // start + dur + release tail
    // some env gain ramps from 0 at the start time
    const events = ctx.gains.flatMap((g) => g.gain.events);
    expect(events.some((e) => e.type === "set" && e.time === 1 && e.value === 0)).toBe(true);
    expect(events.some((e) => e.type === "linramp")).toBe(true);
  });

  it("adds a filter with a cutoff envelope when the patch has one", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    const reverbFilters = ctx.filters.length; // reverb builds lowpass dampers in the ctor
    expect(reverbFilters).toBeGreaterThan(0);
    s.playNote(INSTRUMENTS.pluck, { freq: 440, startTime: 0, durationSeconds: 0.3, velocity: 0.8 });
    expect(ctx.filters.length).toBe(reverbFilters + 1); // exactly one filter for the note
    const noteFilter = ctx.filters[ctx.filters.length - 1]!;
    expect(noteFilter.frequency.events.some((e) => e.type === "target")).toBe(true); // cutoff sweep
  });

  it("scales the envelope peak by velocity and respects reverbSend", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    s.playNote(INSTRUMENTS.sineLead, {
      freq: 440,
      startTime: 0,
      durationSeconds: 0.5,
      velocity: 0.5,
    });
    const ramps = ctx.gains.flatMap((g) => g.gain.events).filter((e) => e.type === "linramp");
    expect(ramps.some((e) => Math.abs(e.value - 0.5) < 1e-9)).toBe(true); // peak ≈ velocity
    expect(ctx.gains.some((g) => Math.abs(g.gain.value - 0.25) < 1e-9)).toBe(true); // sineLead send
  });

  it("disconnects a note's nodes when its last source ends", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    s.playNote(INSTRUMENTS.marimba, {
      freq: 440,
      startTime: 0,
      durationSeconds: 0.2,
      velocity: 0.7,
    });
    const last = ctx.oscillators[ctx.oscillators.length - 1]!;
    expect(typeof last.onended).toBe("function");
    last.onended!();
    expect(ctx.gains.some((g) => g.disconnectCount > 0)).toBe(true);
  });

  it("guards NaN params: no NaN reaches any AudioParam", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    s.playNote(INSTRUMENTS.pluck, { freq: NaN, startTime: 0, durationSeconds: 0.5, velocity: NaN });
    const events = [
      ...ctx.oscillators.flatMap((o) => o.frequency.events),
      ...ctx.gains.flatMap((g) => g.gain.events),
      ...ctx.filters.flatMap((f) => [...f.frequency.events, ...f.Q.events]),
    ];
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(Number.isNaN(e.value)).toBe(false);
  });

  it("keeps envelope event times monotonic for a short note (dur < attack+decay)", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    // marimba attack+decay = 0.283 > dur 0.2 → release must still come after decay
    s.playNote(INSTRUMENTS.marimba, {
      freq: 440,
      startTime: 1,
      durationSeconds: 0.2,
      velocity: 0.7,
    });
    const env = ctx.gains.reduce((a, b) => (b.gain.events.length > a.gain.events.length ? b : a));
    const times = env.gain.events.map((e) => e.time);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!);
  });
});

describe("Synth.playDrum", () => {
  it("kick is a pitch-dropping sine", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    const before = ctx.oscillators.length;
    s.playDrum(DRUM_KITS.default.kick, 2, 1);
    expect(ctx.oscillators.length).toBe(before + 1);
    const osc = ctx.oscillators[ctx.oscillators.length - 1]!;
    expect(osc.type).toBe("sine");
    expect(osc.startedAt).toBe(2);
    expect(osc.frequency.events.some((e) => e.type === "target")).toBe(true);
  });

  it("hat plays the shared noise buffer through a highpass", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    s.playDrum(DRUM_KITS.default.hat, 0, 1);
    expect(ctx.bufferSources.length).toBe(1);
    expect(ctx.bufferSources[0]!.buffer).not.toBeNull();
    expect(ctx.filters.some((f) => f.type === "highpass")).toBe(true);
  });

  it("snare layers a noise burst and a body tone, cleaning up on the last source", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    const oscBefore = ctx.oscillators.length;
    s.playDrum(DRUM_KITS.default.snare, 0, 0.9);
    expect(ctx.bufferSources.length).toBe(1); // noise component
    expect(ctx.oscillators.length).toBe(oscBefore + 1); // body tone
    const tone = ctx.oscillators[ctx.oscillators.length - 1]!;
    expect(tone.type).toBe("triangle");
    expect(ctx.filters.some((f) => f.type === "highpass")).toBe(true);
    expect(typeof tone.onended).toBe("function");
    tone.onended!();
    expect(ctx.gains.some((g) => g.disconnectCount > 0)).toBe(true);
  });
});

describe("Synth lifecycle", () => {
  it("dispose stops sounding notes and silences further play", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    s.playNote(INSTRUMENTS.pluck, { freq: 440, startTime: 0, durationSeconds: 1, velocity: 0.7 });
    const count = ctx.oscillators.length;
    s.dispose();
    expect(ctx.gains.some((g) => g.disconnectCount > 0)).toBe(true);
    s.playNote(INSTRUMENTS.pluck, { freq: 440, startTime: 0, durationSeconds: 1, velocity: 0.7 });
    expect(ctx.oscillators.length).toBe(count); // no-op after dispose
  });

  it("setVolume ramps the master gain (no zipper click)", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    s.setVolume(0.6);
    // master is the first gain created; setVolume ramps via setTargetAtTime, not a hard set.
    expect(ctx.gains[0]!.gain.events.some((e) => e.type === "target" && e.value === 0.6)).toBe(
      true,
    );
  });

  it("dispose stops in-flight sources and disconnects the reverb feedback taps + limiter", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    s.playNote(INSTRUMENTS.pluck, { freq: 440, startTime: 0, durationSeconds: 5, velocity: 0.7 });
    ctx.advance(1);
    const osc = ctx.oscillators[ctx.oscillators.length - 1]!;
    s.dispose();
    expect(osc.stoppedAt).toBe(1); // stopped at the current audio time
    expect(ctx.delays.every((d) => d.disconnectCount > 0)).toBe(true); // taps no longer recirculate
    expect(ctx.shapers.length).toBe(1); // the master soft-clip limiter
    expect(ctx.shapers[0]!.disconnectCount).toBeGreaterThan(0); // no orphan on a borrowed context
  });

  it("a patch with no sources leaks nothing (immediate disconnect, no live entry)", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    const empty: Instrument = {
      name: "empty",
      voices: ["lead"],
      layers: [],
      amp: { attack: 0, decay: 0.1, sustain: 0.5, release: 0.1 },
    };
    const gainsBefore = ctx.gains.length;
    s.playNote(empty, { freq: 440, startTime: 0, durationSeconds: 0.5, velocity: 0.7 });
    expect(ctx.oscillators.length).toBe(0); // no layers → no sources
    expect(ctx.gains.length).toBe(gainsBefore + 1); // just the env gain
    expect(ctx.gains[ctx.gains.length - 1]!.disconnectCount).toBeGreaterThan(0); // disconnected, not parked
  });
});
