/**
 * Browser-side e2e harness (bundled by scripts/build-e2e.mjs, not shipped).
 *
 * Exposes `window.ditty` so the Playwright suite — and ad-hoc listening — can
 * exercise the REAL Web Audio graph in each browser:
 *  - `renderOffline` arranges + plays the actual Synth through an
 *    OfflineAudioContext and returns the waveform's stats (proves audible,
 *    in-range, deterministic sound), and can save a WAV for auditioning.
 *  - a "start" button wired to a real `createEngine` proves the realtime path
 *    resumes and runs from a genuine user gesture.
 */
import {
  DRUM_KITS,
  INSTRUMENTS,
  REVERB_SEND_BY_VOICE,
  SCALES,
  type ScoreVoice,
  arrange,
  instrumentsForVoice,
  makeNoiseTable,
  makeRng,
} from "../src/core";
import { createEngine, type EngineAudioContext } from "../src/engine";
import { type AudioContextLike, Synth } from "../src/synth";
import type { DittyE2E, OfflineRenderResult } from "./types";

const SAMPLE_RATE = 44100;

// A few contrasting styles so renders vary by seed (also showcases the palette).
const STYLES = [
  { parent: SCALES.major, raga: SCALES.mohanam, groove: "straight", bpm: 104, swing: 0 },
  { parent: SCALES.major, raga: SCALES.hamsadhwani, groove: "fourOnFloor", bpm: 120, swing: 0.3 },
  { parent: SCALES.mixolydian, raga: SCALES.madhyamavati, groove: "busy", bpm: 96, swing: 0 },
  { parent: SCALES.naturalMinor, raga: SCALES.hindolam, groove: "halfTime", bpm: 84, swing: 0.2 },
  { parent: SCALES.dorian, raga: SCALES.abhogi, groove: "soft", bpm: 110, swing: 0.45 },
  { parent: SCALES.major, raga: SCALES.shuddhaSaveri, groove: "straight", bpm: 112, swing: 0.15 },
] as const;

function pick(rng: ReturnType<typeof makeRng>, voice: ScoreVoice) {
  return INSTRUMENTS[rng.pick(instrumentsForVoice(voice))];
}

async function renderBuffer(seed: number, seconds: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * seconds), SAMPLE_RATE);
  const style = STYLES[((seed % STYLES.length) + STYLES.length) % STYLES.length]!;
  const master = makeRng(seed);
  const instrumentRng = master.fork();
  const arrangeRng = master.fork();
  const noiseRng = master.fork();
  const synth = new Synth(ctx as unknown as AudioContextLike, {
    noiseTable: makeNoiseTable(noiseRng),
    masterGain: 0.8,
  });
  const instruments: Record<ScoreVoice, ReturnType<typeof pick>> = {
    lead: pick(instrumentRng, "lead"),
    bass: pick(instrumentRng, "bass"),
    pad: pick(instrumentRng, "pad"),
    arp: pick(instrumentRng, "arp"),
  };

  let t = 0;
  let guard = 0;
  while (t < seconds && guard++ < 1000) {
    const score = arrange({
      rng: arrangeRng,
      bpm: style.bpm,
      bars: 8,
      parent: style.parent,
      raga: style.raga,
      groove: style.groove,
      swing: style.swing,
    });
    const spb = 60 / score.bpm;
    for (const part of score.parts) {
      const patch = instruments[part.voice];
      const reverbSend = patch.reverbSend ?? REVERB_SEND_BY_VOICE[part.voice];
      for (const n of part.notes) {
        const startTime = t + n.startBeat * spb;
        if (startTime >= seconds) continue;
        synth.playNote(patch, {
          freq: n.freq,
          startTime,
          durationSeconds: n.durationBeats * spb,
          velocity: n.velocity,
          reverbSend,
        });
      }
    }
    for (const h of score.drums) {
      const startTime = t + h.startBeat * spb;
      if (startTime >= seconds) continue;
      synth.playDrum(h.drum, DRUM_KITS.default[h.drum], startTime, h.velocity);
    }
    t += score.lengthBeats * spb;
  }

  return (await ctx.startRendering()).getChannelData(0);
}

async function renderOffline(seed: number, seconds: number): Promise<OfflineRenderResult> {
  const data = await renderBuffer(seed, seconds);
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

/** Encode mono float samples as a 16-bit PCM WAV (for ad-hoc auditioning). */
function encodeWav(samples: Float32Array): Blob {
  const ab = new ArrayBuffer(44 + samples.length * 2);
  const dv = new DataView(ab);
  const ws = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  ws(0, "RIFF");
  dv.setUint32(4, 36 + samples.length * 2, true);
  ws(8, "WAVE");
  ws(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, SAMPLE_RATE, true);
  dv.setUint32(28, SAMPLE_RATE * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  ws(36, "data");
  dv.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i]!)) * 32767, true);
  }
  return new Blob([ab], { type: "audio/wav" });
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
  renderOffline,
  async renderWavUrl(seed, seconds) {
    return URL.createObjectURL(encodeWav(await renderBuffer(seed, seconds)));
  },
  async renderWavBase64(seed, seconds) {
    const buffer = await encodeWav(await renderBuffer(seed, seconds)).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    return btoa(binary);
  },
  engineState: () => smokeContext.state,
  engineTime: () => smokeContext.currentTime,
};
window.ditty = api;
