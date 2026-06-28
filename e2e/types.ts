/** Shape of the test API the harness exposes on `window` for the e2e suite. */
export interface OfflineRenderResult {
  /** Number of rendered samples. */
  length: number;
  /** Peak absolute amplitude across the buffer. */
  peak: number;
  /** RMS energy across the buffer. */
  rms: number;
  /** A sparse, RAW sample of the waveform — compared with a tolerance, not exact float equality. */
  samples: number[];
}

export interface DittyE2E {
  /** Render `seconds` of the real engine (seeded) through an OfflineAudioContext. */
  renderOffline(seed: number, seconds: number): Promise<OfflineRenderResult>;
  /** Same render, returned as an object URL to a WAV (for ad-hoc auditioning). */
  renderWavUrl(seed: number, seconds: number): Promise<string>;
  /** Same render, returned as a base64 WAV string (for headless capture). */
  renderWavBase64(seed: number, seconds: number): Promise<string>;
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
