/** Shape of the test API the harness exposes on `window` for the e2e suite. */
export interface OfflineRenderResult {
  /** Number of rendered samples. */
  length: number;
  /** Peak absolute amplitude across the buffer. */
  peak: number;
  /** RMS energy across the buffer. */
  rms: number;
  /** A sparse, rounded sample of the waveform — enough to compare renders. */
  fingerprint: number[];
}

export interface DittyE2E {
  /** Render `seconds` of the real synth + melody (seeded) through an OfflineAudioContext. */
  renderOffline(seed: number, seconds: number): Promise<OfflineRenderResult>;
  /** The realtime smoke engine's context state. */
  engineState(): AudioContextState;
  /** The realtime smoke engine's audio clock. */
  engineTime(): number;
}

declare global {
  interface Window {
    ditty: DittyE2E;
    /** The shipped IIFE global (`dist/ditty.global.js`) — the no-build entry. */
    Ditty: typeof import("../src/index");
  }
}
