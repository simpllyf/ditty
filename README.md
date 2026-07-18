# Ditty

[![npm](https://img.shields.io/npm/v/@simpllyf/ditty?color=15a06a&label=npm)](https://www.npmjs.com/package/@simpllyf/ditty) [![license](https://img.shields.io/npm/l/@simpllyf/ditty?color=15a06a)](./LICENSE) ![dependencies](https://img.shields.io/badge/dependencies-0-15a06a) ![types](https://img.shields.io/npm/types/@simpllyf/ditty?color=15a06a)

**A zero-dependency, framework-agnostic generative music engine for the browser.**

Pick a _vibe_, give it a seed, and Ditty arranges endless, non-repetitive
background music — a lead, bass, pad, arpeggio, and drums that follow the chords —
all synthesized through the Web Audio API. No audio files, no samples, no
frameworks. It's coherent and pleasant background music; it won't write you a
hand-composed signature hook, but it never runs out.

- **Coherent, composed.** Functional harmony, in-key ragas, chord tones on strong
  beats, and cadences arrange into a real song form (verse / bridge / climax) with
  key changes and a theme that develops as it recurs — sequenced, mirrored, or
  broadened where the music turns. Never exactly repeating, always looping seamlessly.
- **Rich, in stereo.** ~20 synthesized instruments + drum kits, a formant choir,
  and humanized timing across a stereo field. Seven styles, ~20 scales/ragas.
- **Zero dependencies, deterministic, tiny** (~14.5 KB min+gzip). Same seed →
  identical music; the whole pure brain also runs in Node with no `AudioContext`.
- **Framework-agnostic.** Web Audio only — no DOM access, no framework imports.

> **Early release (0.1.x).** Thoroughly tested and validated end-to-end in
> Chromium, Firefox, and WebKit, but pre-1.0 — the API may still change.

## Install

```sh
npm install @simpllyf/ditty
```

Or drop it into a page with no build step:

```html
<script src="https://unpkg.com/@simpllyf/ditty"></script>
<script>
  const engine = Ditty.createEngine({ style: "calm" });
  document.querySelector("button").addEventListener("click", () => engine.start());
</script>
```

## Usage

```ts
import { createEngine } from "@simpllyf/ditty";

const engine = createEngine({
  style: "peppy", // peppy | calm | playful | dreamy | lofi | cinematic | ambient
  seed: 1234, // omit for a fresh random track each session
  volume: 0.3, // 0..1 — it's background music, keep it gentle
});

// Browsers block audio until a user gesture, so start from a click/tap:
playButton.addEventListener("click", () => engine.start());

engine.setVolume(0.25);
engine.pause(); // suspend; resume() to continue
engine.stop(); // stop and silence; start() again later
engine.dispose(); // tear down (call this on unmount in React/Svelte/etc.)
```

Pick a vibe and let the seed do the rest, or pin any knob yourself — explicit
options always override the style, e.g.
`createEngine({ style: "calm", bpm: 84, voices: { arp: false } })`.

### Background playback

Ditty _synthesizes_ audio from a JavaScript timer — it doesn't stream a pre-rendered
file the way a music app does. Mobile browsers throttle that timer when the tab is
hidden or the screen locks, which starves the scheduler and breaks the audio into gaps.
The engine is deliberately DOM-free, so handle this in your app by pausing while hidden:

```js
document.addEventListener("visibilitychange", () => {
  document.hidden ? engine.pause() : engine.resume();
});
```

For background music that's also the behavior users expect, and it saves battery. (Truly
playing on while the screen is locked is a different thing — it needs a streamed media
element, which a synthesis engine isn't.)

### Options

| Option                           | Default          | Notes                                                                                    |
| -------------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `style`                          | `"peppy"`        | `peppy` \| `calm` \| `playful` \| `dreamy` \| `lofi` \| `cinematic` \| `ambient`         |
| `seed`                           | random           | Set for a reproducible track; omit for variety per session                               |
| `bpm`                            | from style       | Beats per minute (sections may push/pull around it)                                      |
| `beatsPerBar` / `bars`           | from style / `8` | Time signature and bars per section (some styles use 3/4 or 6/8)                         |
| `volume`                         | `0.3`            | Master volume, 0..1                                                                      |
| `evolve`                         | `true`           | Re-draw melodies each pass through the form; `false` repeats the form verbatim           |
| `humanize`                       | `true`           | Subtle off-grid timing + velocity, for a human feel                                      |
| `chromatic`                      | `true`           | Allow occasional borrowed (non-diatonic) chords in bright-major keys                     |
| `voices`                         | all on           | Toggle parts, e.g. `{ pad: false, drums: false }`                                        |
| `parent` / `raga`                | from style       | A `Scale` from `SCALES` (e.g. `SCALES.major`, `SCALES.mohanam`); pair so `raga ⊆ parent` |
| `groove` / `kit`                 | from style       | Drum groove name and drum kit                                                            |
| `rootMidi` / `density` / `swing` | from style       | Tonic MIDI note 36–84; `density` & `swing` are 0..1                                      |
| `audioContext`                   | created lazily   | Bring your own `AudioContext` (or a compatible one)                                      |

## Render to a file

Bake a track offline (faster than realtime) to a stereo WAV — handy for shipping a
loop as an asset:

```ts
import { renderOffline, encodeWav } from "@simpllyf/ditty";

// `loops` renders to exact form boundaries (gapless); or pass `seconds`.
const { sampleRate, channels } = await renderOffline({ style: "dreamy", seed: 7, loops: 4 });
const wav = encodeWav(channels, sampleRate); // Uint8Array (stereo: channels = [left, right])
```

## The pure core

The whole composition pipeline is pure, deterministic, and importable on its own
at `@simpllyf/ditty/core` — no audio — for tests, previews, or building your own
playback layer:

```ts
import { createSession, SCALES } from "@simpllyf/ditty/core";

const session = createSession({ seed: 1234, style: "cinematic" });
const score = session.nextScore();
// score.parts → [{ voice: "lead", notes: [{ startBeat, durationBeats, freq, velocity }] }, ...]
// score.drums → [{ startBeat, drum: "kick" | "snare" | "hat", velocity }]
```

`/core` also exports the building blocks — `arrange`, `generateHarmony`,
`generateMelody`, `SCALES`, `INSTRUMENTS`, `DRUM_GROOVES`, and more.

## Your music is yours

Ditty generates music from **uncopyrightable building blocks** (scales, ragas,
chords, common progressions — all public domain), with no samples and no training
data. Tracks you generate are yours to use freely, commercial or not. The Ditty
**code** is MIT-licensed.

## License

[MIT](./LICENSE) © Simpllyf
