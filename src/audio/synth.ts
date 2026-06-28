/**
 * The synth — the only file in the library that touches Web Audio. Renders any
 * {@link Instrument} patch + the drum kit into nodes.
 *
 * Per note: summed oscillator layers → optional filter (with a cutoff envelope)
 * → an ADSR gain → master (dry) + a reverb send. Reverb is a small feedback-delay
 * network built once on a shared bus (no impulse buffer → smaller, deterministic,
 * no seeded noise). Drums share one pre-filled noise buffer. Notes are
 * schedule-and-forget: each note's subgraph disconnects on its last source's
 * `onended`.
 *
 * The `AudioContext` is INJECTED (never the global) so the whole thing runs
 * against a fake context in Node tests — no real audio required.
 */
import type { DrumVoice, Instrument } from "../instruments";
import { clampSafe } from "../math";

/** The slice of `AudioParam` the synth uses. */
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): void;
  cancelScheduledValues(startTime: number): void;
}
/** The slice of `AudioNode` the synth uses. */
export interface AudioNodeLike {
  connect(destination: AudioNodeLike): void;
  disconnect(): void;
}
export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}
export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorType;
  readonly frequency: AudioParamLike;
  start(when: number): void;
  stop(when: number): void;
  onended: (() => void) | null;
}
export interface BiquadFilterLike extends AudioNodeLike {
  type: BiquadFilterType;
  readonly frequency: AudioParamLike;
  readonly Q: AudioParamLike;
}
export interface WaveShaperLike extends AudioNodeLike {
  curve: Float32Array | null;
}
export interface DelayLike extends AudioNodeLike {
  readonly delayTime: AudioParamLike;
}
export interface AudioBufferLike {
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}
export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  start(when: number): void;
  stop(when: number): void;
  onended: (() => void) | null;
}
/** The slice of `AudioContext` the synth uses; a real `AudioContext`/`OfflineAudioContext` satisfies it. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: AudioNodeLike;
  createOscillator(): OscillatorNodeLike;
  createGain(): GainNodeLike;
  createBiquadFilter(): BiquadFilterLike;
  createWaveShaper(): WaveShaperLike;
  createDelay(maxDelayTime?: number): DelayLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): BufferSourceLike;
}

/** A pitched note resolved to absolute audio time + seconds. */
export interface NoteSpec {
  readonly freq: number;
  readonly startTime: number;
  readonly durationSeconds: number;
  readonly velocity: number;
  /** Wet send 0..1; defaults to the patch's own reverbSend (else 0). */
  readonly reverbSend?: number;
}

export interface SynthOptions {
  noiseTable: Float32Array;
  /** Master volume 0..1. Default 0.35 (background music). */
  masterGain?: number;
  reverb?: { decay?: number; damping?: number; mix?: number };
}

// NaN must not slip through to an AudioParam (clampSafe maps it to the low bound).
const clamp = clampSafe;

/** Gentle soft-clip curve so summed voices can't hard-clip the master. */
function softClipCurve(n = 1024): Float32Array {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(1.2 * x);
  }
  return curve;
}

/** A scheduled note's nodes + its sources (oscillators and/or a buffer source). */
type Source = OscillatorNodeLike | BufferSourceLike;
interface LiveNote {
  readonly nodes: AudioNodeLike[];
  readonly oscs: Source[];
}

const REVERB_DELAYS = [0.0297, 0.0419, 0.0537]; // prime-ish spacing → diffuse tail, not slapback

export class Synth {
  private readonly ctx: AudioContextLike;
  private readonly master: GainNodeLike;
  private readonly limiter: WaveShaperLike;
  private readonly reverbIn: GainNodeLike;
  private readonly reverbNodes: AudioNodeLike[] = [];
  private readonly noiseBuffer: AudioBufferLike;
  private readonly live = new Set<LiveNote>();
  private readonly nyquist: number;
  private disposed = false;

  constructor(ctx: AudioContextLike, options: SynthOptions) {
    this.ctx = ctx;
    this.nyquist = ctx.sampleRate / 2;

    this.master = ctx.createGain();
    this.master.gain.value = clamp(options.masterGain ?? 0.35, 0, 1);
    this.limiter = ctx.createWaveShaper();
    this.limiter.curve = softClipCurve();
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    this.reverbIn = this.buildReverb(options.reverb ?? {});

    this.noiseBuffer = ctx.createBuffer(1, options.noiseTable.length, ctx.sampleRate);
    this.noiseBuffer.getChannelData(0).set(options.noiseTable);
  }

  /** Set master volume, 0..1. Ramped (~20 ms) so live changes don't zipper-click. */
  setVolume(volume: number): void {
    this.master.gain.setTargetAtTime(clamp(volume, 0, 1), this.ctx.currentTime, 0.02);
  }

  private buildReverb(opts: { decay?: number; damping?: number; mix?: number }): GainNodeLike {
    const input = this.ctx.createGain();
    const wet = this.ctx.createGain();
    wet.gain.value = clamp(opts.mix ?? 0.9, 0, 1);
    const feedback = clamp(opts.decay ?? 0.6, 0, 0.92);
    const damping = clamp(opts.damping ?? 3200, 20, this.nyquist);
    for (const time of REVERB_DELAYS) {
      const delay = this.ctx.createDelay(1);
      delay.delayTime.value = time;
      const damp = this.ctx.createBiquadFilter();
      damp.type = "lowpass";
      damp.frequency.value = damping;
      const fb = this.ctx.createGain();
      fb.gain.value = feedback;
      input.connect(delay);
      delay.connect(damp);
      damp.connect(fb);
      fb.connect(delay); // feedback loop
      damp.connect(wet);
      this.reverbNodes.push(delay, damp, fb);
    }
    wet.connect(this.master);
    this.reverbNodes.push(wet);
    return input;
  }

  /** Schedule one pitched note from a patch. */
  playNote(patch: Instrument, note: NoteSpec): void {
    if (this.disposed) return;
    const ctx = this.ctx;
    const { startTime: t0, durationSeconds: dur } = note;
    const { attack: a, decay: d, sustain: s, release: r } = patch.amp;

    const env = ctx.createGain();
    const peak = clamp(note.velocity * (patch.gain ?? 1), 0, 1);
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + a);
    env.gain.linearRampToValueAtTime(peak * s, t0 + a + d);
    const releaseAt = Math.max(t0 + a + d, t0 + dur);
    env.gain.setValueAtTime(peak * s, releaseAt);
    env.gain.linearRampToValueAtTime(0, releaseAt + r);
    const stopAt = releaseAt + r + 0.02;

    const nodes: AudioNodeLike[] = [env];
    let sink: AudioNodeLike = env;
    if (patch.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = patch.filter.type;
      filter.Q.value = clamp(patch.filter.q ?? 1, 0.0001, 30);
      const base = clamp(patch.filter.cutoff, 20, this.nyquist);
      const amount = patch.filter.envAmount ?? 0;
      if (amount > 0) {
        filter.frequency.setValueAtTime(clamp(base + amount, 20, this.nyquist), t0);
        filter.frequency.setTargetAtTime(base, t0, Math.max(0.001, patch.filter.envDecay ?? 0.1));
      } else {
        filter.frequency.setValueAtTime(base, t0);
      }
      filter.connect(env);
      nodes.push(filter);
      sink = filter;
    }

    const oscs: OscillatorNodeLike[] = [];
    for (const layer of patch.layers) {
      const osc = ctx.createOscillator();
      osc.type = layer.kind;
      const detune = Math.pow(2, (layer.detuneCents ?? 0) / 1200);
      osc.frequency.setValueAtTime(
        clamp(note.freq * (layer.ratio ?? 1) * detune, 0, this.nyquist),
        t0,
      );
      const layerGain = layer.gain ?? 1;
      if (layerGain !== 1) {
        const g = ctx.createGain();
        g.gain.value = clamp(layerGain, 0, 1);
        osc.connect(g);
        g.connect(sink);
        nodes.push(g);
      } else {
        osc.connect(sink);
      }
      osc.start(t0);
      osc.stop(stopAt);
      oscs.push(osc);
    }

    env.connect(this.master);
    const send = clamp(note.reverbSend ?? patch.reverbSend ?? 0, 0, 1);
    if (send > 0) {
      const sendGain = ctx.createGain();
      sendGain.gain.value = send;
      env.connect(sendGain);
      sendGain.connect(this.reverbIn);
      nodes.push(sendGain);
    }

    this.register(nodes, oscs);
  }

  /** Schedule one drum hit, synthesized per its `kind` (data-driven, not name-switched). */
  playDrum(voice: DrumVoice, startTime: number, velocity: number): void {
    if (this.disposed) return;
    const ctx = this.ctx;
    const peak = clamp(velocity * voice.gain, 0, 1);
    const stopAt = startTime + voice.ampDecay + 0.05;
    const tc = Math.max(0.001, voice.ampDecay / 3);
    const env = ctx.createGain();
    env.gain.setValueAtTime(peak, startTime);
    env.gain.setTargetAtTime(0, startTime, tc); // exponential decay — keeps the percussive punch
    // Fade only the tiny residual to true 0 over the last 8 ms so the source can
    // stop without a click — anchoring the curve's value first so the exponential
    // shape is preserved up to the fade (a bare ramp-to-0 would flatten the decay).
    const fadeStart = stopAt - 0.008;
    env.gain.setValueAtTime(peak * Math.exp(-(fadeStart - startTime) / tc), fadeStart);
    env.gain.linearRampToValueAtTime(0, stopAt);
    env.connect(this.master);

    const nodes: AudioNodeLike[] = [env];

    if (voice.kind === "tone") {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(clamp(voice.freqStart ?? 120, 20, this.nyquist), startTime);
      osc.frequency.setTargetAtTime(
        clamp(voice.freqEnd ?? 48, 20, this.nyquist),
        startTime,
        Math.max(0.001, voice.pitchDecay ?? 0.03),
      );
      osc.connect(env);
      osc.start(startTime);
      osc.stop(stopAt);
      this.register(nodes, [osc]);
      return;
    }

    const oscs: Source[] = [];
    if (voice.noiseGain) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      let tail: AudioNodeLike = src;
      if (voice.highpass) {
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = clamp(voice.highpass, 20, this.nyquist);
        src.connect(hp);
        nodes.push(hp);
        tail = hp;
      }
      const ng = ctx.createGain();
      ng.gain.value = clamp(voice.noiseGain, 0, 1);
      tail.connect(ng);
      ng.connect(env);
      nodes.push(ng);
      src.start(startTime);
      src.stop(stopAt);
      oscs.push(src);
    }
    if (voice.toneGain && voice.freqStart) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(clamp(voice.freqStart, 20, this.nyquist), startTime);
      const tg = ctx.createGain();
      tg.gain.value = clamp(voice.toneGain, 0, 1);
      osc.connect(tg);
      tg.connect(env);
      nodes.push(tg);
      osc.start(startTime);
      osc.stop(stopAt);
      oscs.push(osc);
    }
    this.register(nodes, oscs);
  }

  private register(nodes: AudioNodeLike[], oscs: Source[]): void {
    const last = oscs[oscs.length - 1];
    if (!last) {
      // No source means nothing will ever fire onended; disconnect now so the
      // note can't leak (only reachable via a malformed patch/drum voice).
      for (const n of nodes) n.disconnect();
      return;
    }
    const entry: LiveNote = { nodes, oscs };
    this.live.add(entry);
    last.onended = () => {
      for (const n of nodes) n.disconnect();
      this.live.delete(entry);
    };
  }

  /** Stop all sounding notes and tear down the graph. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const now = this.ctx.currentTime;
    for (const note of this.live) {
      for (const osc of note.oscs) osc.stop(now);
      for (const n of note.nodes) n.disconnect();
    }
    this.live.clear();
    this.master.disconnect();
    this.limiter.disconnect();
    this.reverbIn.disconnect();
    for (const node of this.reverbNodes) node.disconnect(); // stop the feedback taps recirculating
  }
}
