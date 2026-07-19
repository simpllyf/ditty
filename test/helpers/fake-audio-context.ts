/**
 * A fake AudioContext with a controllable clock — records every node, param
 * automation event, and start/stop so the synth, scheduler, and engine can be
 * tested with no real audio. Implements the slice the engine uses
 * ({@link AudioContextLike} and friends from `src/synth`).
 */
import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterLike,
  BufferSourceLike,
  DelayLike,
  GainNodeLike,
  OscillatorNodeLike,
  StereoPannerLike,
  WaveShaperLike,
} from "../../src/audio/synth";

export type ParamEventType = "set" | "linramp" | "target" | "cancel" | "hold";

export interface ParamEvent {
  readonly type: ParamEventType;
  readonly value: number;
  readonly time: number;
}

export class FakeParam implements AudioParamLike {
  value: number;
  readonly events: ParamEvent[] = [];

  constructor(value: number) {
    this.value = value;
  }

  setValueAtTime(value: number, startTime: number): void {
    this.value = value;
    this.events.push({ type: "set", value, time: startTime });
  }

  linearRampToValueAtTime(value: number, endTime: number): void {
    this.events.push({ type: "linramp", value, time: endTime });
  }

  setTargetAtTime(target: number, startTime: number): void {
    this.events.push({ type: "target", value: target, time: startTime });
  }

  cancelScheduledValues(startTime: number): void {
    this.events.push({ type: "cancel", value: 0, time: startTime });
  }

  cancelAndHoldAtTime(cancelTime: number): void {
    this.events.push({ type: "hold", value: this.value, time: cancelTime });
  }
}

class FakeNode implements AudioNodeLike {
  readonly connectedTo: (AudioNodeLike | AudioParamLike)[] = [];
  disconnectCount = 0;
  connect(destination: AudioNodeLike | AudioParamLike): void {
    this.connectedTo.push(destination);
  }
  disconnect(): void {
    this.disconnectCount++;
  }
}

export class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam(1);
}

export class FakeOscillator extends FakeNode implements OscillatorNodeLike {
  /** The custom shape applied, if any — a plain oscillator keeps its `type`. */
  periodicWave: object | null = null;
  setPeriodicWave(wave: object): void {
    this.periodicWave = wave;
  }
  type: OscillatorType = "sine";
  readonly frequency = new FakeParam(440);
  readonly detune = new FakeParam(0);
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  start(when: number): void {
    this.startedAt = when;
  }
  stop(when: number): void {
    this.stoppedAt = when;
  }
}

export class FakeBiquad extends FakeNode implements BiquadFilterLike {
  type: BiquadFilterType = "lowpass";
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
}

export class FakeWaveShaper extends FakeNode implements WaveShaperLike {
  curve: Float32Array | null = null;
  oversample: OverSampleType = "none";
}

export class FakeDelay extends FakeNode implements DelayLike {
  readonly delayTime = new FakeParam(0);
}

export class FakeStereoPanner extends FakeNode implements StereoPannerLike {
  readonly pan = new FakeParam(0);
}

export class FakeBuffer implements AudioBufferLike {
  readonly length: number;
  private readonly data: Float32Array[];
  constructor(length: number, channels = 1) {
    this.length = length;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(channel = 0): Float32Array {
    return this.data[channel] ?? this.data[0]!;
  }
}

export class FakeBufferSource extends FakeNode implements BufferSourceLike {
  buffer: AudioBufferLike | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  start(when: number): void {
    this.startedAt = when;
  }
  stop(when: number): void {
    this.stoppedAt = when;
  }
}

class FakeDestination extends FakeNode {}

export class FakeAudioContext implements AudioContextLike {
  currentTime = 0;
  readonly sampleRate: number;
  state: AudioContextState = "suspended";
  readonly destination = new FakeDestination();
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  readonly filters: FakeBiquad[] = [];
  readonly delays: FakeDelay[] = [];
  readonly shapers: FakeWaveShaper[] = [];
  readonly panners: FakeStereoPanner[] = [];
  readonly bufferSources: FakeBufferSource[] = [];
  resumeCount = 0;
  suspendCount = 0;
  closeCount = 0;
  failResume = false;
  failSuspend = false;
  failClose = false;
  deferResume = false;
  private pendingResume: (() => void) | null = null;

  constructor(sampleRate = 44100) {
    this.sampleRate = sampleRate;
  }

  createOscillator(): FakeOscillator {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createBiquadFilter(): FakeBiquad {
    const f = new FakeBiquad();
    this.filters.push(f);
    return f;
  }
  createWaveShaper(): FakeWaveShaper {
    const w = new FakeWaveShaper();
    this.shapers.push(w);
    return w;
  }
  createDelay(): FakeDelay {
    const d = new FakeDelay();
    this.delays.push(d);
    return d;
  }
  createStereoPanner(): FakeStereoPanner {
    const p = new FakeStereoPanner();
    this.panners.push(p);
    return p;
  }
  createBuffer(channels: number, length: number): FakeBuffer {
    return new FakeBuffer(length, channels);
  }
  /** Records the shape so a test can see WHICH wave was asked for, not just that one was. */
  readonly periodicWaves: { real: number[]; imag: number[] }[] = [];
  createPeriodicWave(real: Float32Array, imag: Float32Array): object {
    const wave = { real: [...real], imag: [...imag] };
    this.periodicWaves.push(wave);
    return wave;
  }

  createBufferSource(): FakeBufferSource {
    const s = new FakeBufferSource();
    this.bufferSources.push(s);
    return s;
  }

  resume(): Promise<void> {
    this.resumeCount++;
    if (this.failResume) return Promise.reject(new Error("resume failed"));
    if (this.deferResume) {
      return new Promise<void>((resolve) => {
        this.pendingResume = () => {
          this.state = "running";
          resolve();
        };
      });
    }
    this.state = "running";
    return Promise.resolve();
  }

  /** Resolve a deferred resume() (see {@link deferResume}). */
  flushResume(): void {
    this.pendingResume?.();
    this.pendingResume = null;
  }

  suspend(): Promise<void> {
    this.suspendCount++;
    if (this.failSuspend) return Promise.reject(new Error("suspend failed"));
    this.state = "suspended";
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCount++;
    if (this.failClose) return Promise.reject(new Error("close failed"));
    this.state = "closed";
    return Promise.resolve();
  }

  /** Advance the controllable clock. */
  advance(seconds: number): void {
    this.currentTime += seconds;
  }
}

/** A FakeAudioContext that also satisfies the offline-render contract. */
export class FakeOfflineAudioContext extends FakeAudioContext {
  readonly length: number;
  readonly numberOfChannels: number;
  renderCount = 0;
  /** Optional: stamp known content into each rendered channel — lets tests assert DSP that runs on the result (e.g. the gapless tail-wrap), instead of an all-zero buffer. */
  onRenderFill?: (data: Float32Array, channel: number) => void;

  constructor(length: number, sampleRate = 44100, numberOfChannels = 2) {
    super(sampleRate);
    this.length = length;
    this.numberOfChannels = numberOfChannels;
  }

  startRendering(): Promise<FakeBuffer> {
    this.renderCount++;
    const buffer = new FakeBuffer(this.length, this.numberOfChannels);
    if (this.onRenderFill) {
      for (let ch = 0; ch < this.numberOfChannels; ch++)
        this.onRenderFill(buffer.getChannelData(ch), ch);
    }
    return Promise.resolve(buffer);
  }
}
