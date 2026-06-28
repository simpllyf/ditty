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
  WaveShaperLike,
} from "../../src/synth";

export type ParamEventType = "set" | "linramp" | "target" | "cancel";

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
}

class FakeNode implements AudioNodeLike {
  readonly connectedTo: AudioNodeLike[] = [];
  disconnectCount = 0;
  connect(destination: AudioNodeLike): void {
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
  type: OscillatorType = "sine";
  readonly frequency = new FakeParam(440);
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
}

export class FakeDelay extends FakeNode implements DelayLike {
  readonly delayTime = new FakeParam(0);
}

export class FakeBuffer implements AudioBufferLike {
  readonly length: number;
  private readonly data: Float32Array;
  constructor(length: number) {
    this.length = length;
    this.data = new Float32Array(length);
  }
  getChannelData(): Float32Array {
    return this.data;
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
  createBuffer(_channels: number, length: number): FakeBuffer {
    return new FakeBuffer(length);
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
  renderCount = 0;

  constructor(length: number, sampleRate = 44100) {
    super(sampleRate);
    this.length = length;
  }

  startRendering(): Promise<FakeBuffer> {
    this.renderCount++;
    return Promise.resolve(new FakeBuffer(this.length));
  }
}
