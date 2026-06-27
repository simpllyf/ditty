/**
 * Browser-side e2e harness (bundled by scripts/build-e2e.mjs, not shipped).
 *
 * Exposes `window.ditty` so the Playwright suite can exercise the REAL Web Audio
 * graph in each browser:
 *  - `renderOffline` drives the actual Synth + MelodyStream through an
 *    OfflineAudioContext and returns the rendered waveform's stats — proving the
 *    engine makes audible, in-range, deterministic sound (no realtime/autoplay).
 *  - a "start" button wired to a full `createPeppyEngine` proves the realtime
 *    path resumes and runs from a genuine user gesture.
 */
import { MelodyStream, makeRng } from "../src/core";
import { createPeppyEngine } from "../src/engine";
import { Synth } from "../src/synth";
import type { DittyE2E, OfflineRenderResult } from "./types";

const SAMPLE_RATE = 44100;
const SECONDS_PER_BEAT = 60 / 128;

async function renderOffline(seed: number, seconds: number): Promise<OfflineRenderResult> {
  const ctx = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * seconds), SAMPLE_RATE);
  const synth = new Synth(ctx, { volume: 0.8, maxVoices: 48 });
  const stream = new MelodyStream({ rng: makeRng(seed) });

  let anchor: number | null = null;
  let guard = 0;
  scheduling: while (guard++ < 10_000) {
    const bar = stream.next();
    if (bar.length === 0) continue;
    if (anchor === null) anchor = bar[0]!.startBeat;
    for (const event of bar) {
      const startTime = (event.startBeat - anchor) * SECONDS_PER_BEAT;
      if (startTime >= seconds) break scheduling;
      synth.play({
        voice: event.voice,
        frequency: event.frequency,
        startTime,
        durationSeconds: event.durationBeats * SECONDS_PER_BEAT,
        velocity: event.velocity,
      });
    }
  }

  const data = (await ctx.startRendering()).getChannelData(0);
  let peak = 0;
  let sumSquares = 0;
  for (let i = 0; i < data.length; i++) {
    const value = data[i]!;
    const abs = Math.abs(value);
    if (abs > peak) peak = abs;
    sumSquares += value * value;
  }
  const fingerprint: number[] = [];
  for (let i = 0; i < data.length; i += 997) {
    fingerprint.push(Math.round(data[i]! * 1e6) / 1e6);
  }
  return { length: data.length, peak, rms: Math.sqrt(sumSquares / data.length), fingerprint };
}

// Realtime smoke: own an injected context so the test can read its state/clock.
const smokeContext = new AudioContext();
const smokeEngine = createPeppyEngine({ seed: 12345, audioContext: smokeContext });

const button = document.createElement("button");
button.id = "ditty-start";
button.textContent = "start";
button.addEventListener("click", () => {
  void smokeEngine.start();
});
document.body.appendChild(button);

const api: DittyE2E = {
  renderOffline,
  engineState: () => smokeContext.state,
  engineTime: () => smokeContext.currentTime,
};
window.ditty = api;
