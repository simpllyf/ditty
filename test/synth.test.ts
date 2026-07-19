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

  it("builds a parallel band-pass bank wired into the source (vowel patch)", () => {
    const ctx = new FakeAudioContext();
    make(ctx).playNote(INSTRUMENTS.choir, {
      freq: 220,
      startTime: 0,
      durationSeconds: 1,
      velocity: 0.7,
    });
    const formant = INSTRUMENTS.choir.formant;
    const bandpasses = ctx.filters.filter((f) => f.type === "bandpass");
    expect(bandpasses.length).toBe(formant.length); // one band per formant peak
    const freqs = bandpasses.flatMap((f) => f.frequency.events.map((e) => e.value));
    for (const peak of formant) expect(freqs).toContain(peak.freq);
    // The source must actually reach the bank: a gain (formantIn) fans out to every
    // band-pass, and each carrier oscillator routes into it (directly or via a layer gain).
    const formantIn = ctx.gains.find((g) => bandpasses.every((bp) => g.connectedTo.includes(bp)));
    expect(formantIn).toBeDefined();
    const carriers = ctx.oscillators.filter((o) => !o.frequency.events.some((e) => e.value <= 40));
    for (const osc of carriers) {
      const reaches =
        osc.connectedTo.includes(formantIn!) ||
        ctx.gains.some((g) => osc.connectedTo.includes(g) && g.connectedTo.includes(formantIn!));
      expect(reaches).toBe(true);
    }
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

  it("vibrato adds an LFO that drives each layer's detune (eased in)", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    const v: Instrument = {
      name: "v",
      voices: ["lead"],
      layers: [{ kind: "sine" }],
      amp: { attack: 0, decay: 0.1, sustain: 0.7, release: 0.1 },
      vibrato: { rateHz: 5, depthCents: 20, delaySec: 0.2 },
    };
    s.playNote(v, { freq: 440, startTime: 0, durationSeconds: 0.5, velocity: 0.7 });
    const lfo = ctx.oscillators.find((o) => o.frequency.events.some((e) => e.value === 5));
    expect(lfo).toBeDefined(); // the 5 Hz LFO
    const layerOsc = ctx.oscillators.find((o) => o.frequency.events.some((e) => e.value === 440));
    // a depth gain feeds the layer oscillator's detune param, ramping 0 → 20 cents
    const depth = ctx.gains.find((g) => g.connectedTo.includes(layerOsc!.detune));
    expect(depth).toBeDefined();
    expect(depth!.gain.events).toEqual([
      { type: "set", value: 0, time: 0 },
      { type: "linramp", value: 20, time: 0.2 },
    ]);
  });

  it("tremolo adds an LFO-modulated gain stage", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    const t: Instrument = {
      name: "t",
      voices: ["pad"],
      layers: [{ kind: "sine" }],
      amp: { attack: 0, decay: 0.1, sustain: 0.8, release: 0.1 },
      tremolo: { rateHz: 6, depth: 0.3 },
    };
    s.playNote(t, { freq: 220, startTime: 0, durationSeconds: 0.5, velocity: 0.7 });
    const lfo = ctx.oscillators.find((o) => o.frequency.events.some((e) => e.value === 6));
    expect(lfo).toBeDefined();
    // a depth gain (0.3) modulates a tremolo gain's gain param
    const tremGain = ctx.gains.find((g) => g.gain.events.some((e) => e.value === 1));
    const depth = ctx.gains.find((g) => g.connectedTo.includes(tremGain!.gain));
    expect(depth!.gain.events.some((e) => e.value === 0.3)).toBe(true);
  });

  it("an fm layer adds a modulator that bends the carrier frequency, decaying", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    const p: Instrument = {
      name: "fm",
      voices: ["lead"],
      layers: [{ kind: "sine", fm: { ratio: 2, index: 3, decay: 0.3 } }],
      amp: { attack: 0, decay: 0.1, sustain: 0.7, release: 0.1 },
    };
    s.playNote(p, { freq: 200, startTime: 0, durationSeconds: 0.5, velocity: 0.7 });
    const carrier = ctx.oscillators.find((o) => o.frequency.events.some((e) => e.value === 200));
    const mod = ctx.oscillators.find((o) => o.frequency.events.some((e) => e.value === 400)); // 200×ratio
    expect(carrier).toBeDefined();
    expect(mod).toBeDefined();
    // peak deviation = index×modHz = 3×400 = 1200, driving the carrier frequency, decaying to 0
    const modGain = ctx.gains.find((g) => g.connectedTo.includes(carrier!.frequency));
    expect(modGain).toBeDefined();
    expect(modGain!.gain.events.some((e) => e.type === "set" && e.value === 1200)).toBe(true);
    expect(modGain!.gain.events.some((e) => e.type === "target" && e.value === 0)).toBe(true);
  });

  it("a noise layer adds filtered breath routed into the amp chain", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    const p: Instrument = {
      name: "breathy",
      voices: ["lead"],
      layers: [{ kind: "sine" }],
      amp: { attack: 0.05, decay: 0.1, sustain: 0.7, release: 0.1 },
      noise: { gain: 0.05, highpass: 2000 },
    };
    const before = ctx.bufferSources.length;
    s.playNote(p, { freq: 440, startTime: 0, durationSeconds: 0.5, velocity: 0.7 });
    expect(ctx.bufferSources.length).toBe(before + 1); // the breath noise source
    expect(ctx.filters.some((f) => f.type === "highpass")).toBe(true); // band-limited up high
    expect(ctx.gains.some((g) => Math.abs(g.gain.value - 0.05) < 1e-9)).toBe(true); // breath mix level
  });

  it("a patch with neither vibrato nor tremolo adds no LFO", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    s.playNote(INSTRUMENTS.pluck, { freq: 440, startTime: 0, durationSeconds: 0.3, velocity: 0.7 });
    expect(ctx.oscillators.length).toBe(INSTRUMENTS.pluck.layers.length); // no extra LFO osc
  });

  it("every instrument in the registry renders cleanly (no NaN params)", () => {
    for (const patch of Object.values(INSTRUMENTS)) {
      const ctx = new FakeAudioContext();
      const s = make(ctx);
      s.playNote(patch, { freq: 440, startTime: 0, durationSeconds: 0.5, velocity: 0.7 });
      const events = [
        ...ctx.oscillators.flatMap((o) => [...o.frequency.events, ...o.detune.events]),
        ...ctx.gains.flatMap((g) => g.gain.events),
        ...ctx.filters.flatMap((f) => [...f.frequency.events, ...f.Q.events]),
      ];
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) expect(Number.isNaN(e.value)).toBe(false);
    }
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

  // The data-driven kinds (custom kits are a stated extension path).
  it("a custom 'tone' voice is a pitch-dropping sine with no noise", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    s.playDrum({ kind: "tone", gain: 0.8, ampDecay: 0.2, freqStart: 200, freqEnd: 60 }, 0, 1);
    expect(ctx.oscillators.length).toBe(1);
    expect(ctx.oscillators[0]!.type).toBe("sine");
    expect(ctx.bufferSources.length).toBe(0);
  });

  it("a custom 'noise' voice is filtered noise with no tone (highpass optional)", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    s.playDrum({ kind: "noise", gain: 0.5, ampDecay: 0.1, noiseGain: 1 }, 0, 1); // no highpass
    expect(ctx.bufferSources.length).toBe(1);
    expect(ctx.oscillators.length).toBe(0);
    expect(ctx.filters.some((f) => f.type === "highpass")).toBe(false);
  });

  it("a custom 'mixed' voice layers noise and a body tone", () => {
    const ctx = new FakeAudioContext();
    const s = make(ctx);
    s.playDrum(
      { kind: "mixed", gain: 0.5, ampDecay: 0.15, freqStart: 180, noiseGain: 0.6, toneGain: 0.4 },
      0,
      0.9,
    );
    expect(ctx.bufferSources.length).toBe(1);
    expect(ctx.oscillators.length).toBe(1);
    expect(ctx.oscillators[0]!.type).toBe("triangle");
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

  it("oversamples the master soft-clip limiter so its harmonics don't alias", () => {
    const ctx = new FakeAudioContext();
    make(ctx);
    expect(ctx.shapers.length).toBe(1); // the master limiter
    expect(ctx.shapers[0]!.curve).not.toBeNull(); // soft-clip curve installed
    expect(ctx.shapers[0]!.oversample).toBe("4x"); // anti-aliased waveshaping
  });
});

describe("slide (a note reached by gliding)", () => {
  const patch = INSTRUMENTS.sineLead;

  it("starts the pitch off target and ramps it onto the note, in cents", () => {
    const ctx = new FakeAudioContext();
    const synth = new Synth(ctx, { noiseTable: new Float32Array(64) });
    synth.playNote(patch, {
      freq: 440,
      startTime: 2,
      durationSeconds: 1,
      velocity: 0.7,
      slideFromCents: -700,
      slideSeconds: 0.06,
    });
    // Detune is in CENTS, so a LINEAR ramp here is an exponential glide in Hz — equal
    // musical distance per unit time, which is what one gesture sounds like.
    for (const osc of ctx.oscillators.filter((o) => o.frequency.value > 20)) {
      const evs = osc.detune.events;
      expect(evs[0]).toEqual({ type: "set", value: -700, time: 2 });
      expect(evs[1]).toEqual({ type: "linramp", value: 0, time: 2.06 });
    }
  });

  it("leaves the pitch alone when the note has no slide", () => {
    const ctx = new FakeAudioContext();
    const synth = new Synth(ctx, { noiseTable: new Float32Array(64) });
    synth.playNote(patch, { freq: 440, startTime: 0, durationSeconds: 1, velocity: 0.7 });
    for (const osc of ctx.oscillators) {
      expect(osc.detune.events.filter((e) => e.type === "linramp")).toEqual([]);
    }
  });

  it("bends every layer of a stacked patch, so it glides as one voice", () => {
    // supersaw stacks detuned saws; bending only some would smear into a chorus.
    const ctx = new FakeAudioContext();
    const synth = new Synth(ctx, { noiseTable: new Float32Array(64) });
    synth.playNote(INSTRUMENTS.supersaw, {
      freq: 220,
      startTime: 0,
      durationSeconds: 1,
      velocity: 0.7,
      slideFromCents: 500,
      slideSeconds: 0.05,
    });
    const carriers = ctx.oscillators.filter((o) => o.frequency.value > 20);
    expect(carriers.length).toBeGreaterThan(1);
    for (const osc of carriers) {
      expect(osc.detune.events.some((e) => e.type === "set" && e.value === 500)).toBe(true);
      expect(osc.detune.events.some((e) => e.type === "linramp" && e.value === 0)).toBe(true);
    }
  });
});
