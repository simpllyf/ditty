/**
 * A fake AudioContext with a controllable clock — records every node, param
 * automation event, and start/stop so the synth and scheduler can be tested
 * with no real audio. Implements only the slice the engine uses
 * ({@link AudioContextLike} and friends).
 */
import type {
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  GainNodeLike,
  OscillatorNodeLike,
} from "../../src/synth";

export type ParamEventType = "set" | "linramp" | "cancel";

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

  cancelScheduledValues(startTime: number): void {
    this.events.push({ type: "cancel", value: 0, time: startTime });
  }
}

export class FakeGain implements GainNodeLike {
  readonly gain = new FakeParam(1);
  readonly connectedTo: AudioNodeLike[] = [];
  disconnectCount = 0;

  connect(destination: AudioNodeLike): void {
    this.connectedTo.push(destination);
  }

  disconnect(): void {
    this.disconnectCount++;
  }
}

export class FakeOscillator implements OscillatorNodeLike {
  type: OscillatorType = "sine";
  readonly frequency = new FakeParam(440);
  readonly connectedTo: AudioNodeLike[] = [];
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  disconnectCount = 0;

  connect(destination: AudioNodeLike): void {
    this.connectedTo.push(destination);
  }

  disconnect(): void {
    this.disconnectCount++;
  }

  start(when: number): void {
    this.startedAt = when;
  }

  stop(when: number): void {
    this.stoppedAt = when;
  }
}

class FakeDestination implements AudioNodeLike {
  connect(): void {}
  disconnect(): void {}
}

export class FakeAudioContext implements AudioContextLike {
  currentTime = 0;
  readonly destination = new FakeDestination();
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];

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

  /** Advance the controllable clock. */
  advance(seconds: number): void {
    this.currentTime += seconds;
  }
}
