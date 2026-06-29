/**
 * Browser-side e2e harness (bundled by scripts/build-e2e.mjs, not shipped).
 *
 * Exposes `window.ditty` so the Playwright suite — and ad-hoc listening — can
 * exercise the REAL Web Audio graph in each browser, dogfooding the library's own
 * `renderOffline` + `encodeWav`:
 *  - `renderOffline` bakes seeded music through an OfflineAudioContext and returns
 *    the waveform's stats (proves audible, in-range, deterministic sound), and can
 *    hand back a WAV for auditioning.
 *  - a "start" button wired to a real `createEngine` proves the realtime path
 *    resumes and runs from a genuine user gesture.
 */
import { createEngine, type EngineAudioContext } from "../src/audio/engine";
import { encodeWav, renderOffline } from "../src/audio/render";
import type { DittyE2E, OfflineRenderResult } from "./types";

const STYLE_NAMES = ["peppy", "calm", "playful", "dreamy"] as const;

const styleFor = (seed: number) =>
  STYLE_NAMES[((seed % STYLE_NAMES.length) + STYLE_NAMES.length) % STYLE_NAMES.length]!;

const render = (seed: number, seconds: number) =>
  renderOffline({ seed, seconds, style: styleFor(seed), volume: 0.85 });

async function renderStats(seed: number, seconds: number): Promise<OfflineRenderResult> {
  const { channels } = await render(seed, seconds);
  const data = channels[0]!; // analyse the left channel (deterministic, representative)
  let peak = 0;
  let sumSquares = 0;
  for (let i = 0; i < data.length; i++) {
    const value = data[i]!;
    const abs = Math.abs(value);
    if (abs > peak) peak = abs;
    sumSquares += value * value;
  }
  // A sparse, RAW (un-rounded) sample of the waveform. Real-browser audio DSP is
  // not bit-reproducible across renders, so the suite compares these with a
  // tolerance — never by exact float equality.
  const samples: number[] = [];
  for (let i = 0; i < data.length; i += 997) {
    samples.push(data[i]!);
  }
  return { length: data.length, peak, rms: Math.sqrt(sumSquares / data.length), samples };
}

async function wavBytes(seed: number, seconds: number): Promise<Uint8Array> {
  const { channels, sampleRate } = await render(seed, seconds);
  return encodeWav(channels, sampleRate);
}

// Realtime smoke: own an injected context so the test can read its state/clock.
const smokeContext = new AudioContext();
const smokeEngine = createEngine({
  seed: 12345,
  audioContext: smokeContext as unknown as EngineAudioContext,
});

const button = document.createElement("button");
button.id = "ditty-start";
button.textContent = "start";
button.addEventListener("click", () => {
  void smokeEngine.start();
});
document.body.appendChild(button);

const api: DittyE2E = {
  renderOffline: renderStats,
  async renderWavUrl(seed, seconds) {
    const bytes = await wavBytes(seed, seconds);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "audio/wav" });
    return URL.createObjectURL(blob);
  },
  async renderWavBase64(seed, seconds) {
    const bytes = await wavBytes(seed, seconds);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    return btoa(binary);
  },
  engineState: () => smokeContext.state,
  engineTime: () => smokeContext.currentTime,
};
window.ditty = api;
