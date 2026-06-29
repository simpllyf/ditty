# Ditty

**A zero-dependency, framework-agnostic generative music engine for the browser.**

Ditty composes endless, non-repetitive, melodic background music — harmony-led
and multi-instrument — entirely synthesized through the Web Audio API. No audio
files, no samples, no frameworks. Pick a _vibe_, give it a seed, and it arranges
a lead, bass, pad, arpeggio, and drums into a **song form** that follows the
chords. Built for kid-friendly learning apps and games, but standalone and
reusable anywhere.

```
┌──────── pure brain (runs in Node, no audio) ────────┐   ┌──── thin audio shell ────┐
  scales/ragas → chords → progressions → harmony          synth (patches, filter,
  → rhythm/grooves → melody → form (sections) →           formants, reverb, stereo)
  arranger → Score                                    →   ← scheduler            → 🔊
└─────────────────────────────────────────────────────┘   └──────────────────────────┘
```

- **A real song form, not one loop.** Each piece moves through contrasting
  sections (verse / bridge / climax) with drum fills into the changes, a loud/soft
  dynamics arc, key changes, per-section tempo, a recurring theme, and per-section
  orchestration — a composed arc that develops, then loops seamlessly.
- **Coherent, not random.** Functional harmony (T–S–D progressions, cadences),
  in-key ragas, chord tones on strong beats, leap caps, anti-repeat, and tasteful
  borrowed chords — the melody follows the chords, so it sounds composed.
- **Endless variety.** Seven styles, ~20 scales/ragas, and a fresh arrangement
  every pass over a constant grid — it never exactly repeats yet loops seamlessly.
- **Rich & multi-instrument, in stereo.** ~20 synthesized instruments (plucks,
  pads, bells, e-piano, strings, a formant **choir**, sub bass, …) + drum kits,
  placed across a stereo field, with subtly **humanized** timing and dynamics.
- **Zero runtime dependencies.** Web Audio is the only thing it needs — enforced
  in CI.
- **Deterministic.** One seeded PRNG drives everything. Same seed → identical
  music. The whole musical brain runs and is tested in Node with no `AudioContext`.
  (A seed reproduces within a `STREAM_EPOCH`; persist it alongside the seed to know
  when an upgrade would re-roll the track.)
- **Small.** ~12.5 KB min+gzip for the full engine, tree-shakeable, side-effect-free.
- **Framework-agnostic.** No DOM access, no framework imports.

> **Pre-release (0.0.x).** Feature-complete, thoroughly unit-tested (340+ tests,
> property-based + golden snapshots), and validated end-to-end in Chromium,
> Firefox, and WebKit (real Web Audio output), pending the first npm publish.

## Install

```sh
npm install @simpllyf/ditty
```

Or drop it into a plain HTML page with no build step:

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

// MUST be called from a user gesture (click/tap/keydown) — see below.
await engine.start();

engine.setVolume(0.25);
engine.pause(); // suspend audio, keep state
engine.resume();
engine.stop(); // stop and silence, keep the context for a later start()
engine.dispose(); // tear down nodes, release the context
```

Pick a vibe and let the seed do the rest, or pin any musical knob yourself.
Explicit options always override the style:

```ts
createEngine({ style: "calm", bpm: 84, voices: { arp: false } });
```

### Options

| Option                           | Default        | Notes                                                                                                                  |
| -------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `style`                          | `"peppy"`      | `peppy` \| `calm` \| `playful` \| `dreamy` \| `lofi` \| `cinematic` \| `ambient`                                       |
| `seed`                           | random         | Set for a reproducible track; omit for variety per session                                                             |
| `bpm`                            | from style     | Beats per minute (the home tempo; sections may push/pull around it)                                                    |
| `beatsPerBar`                    | `4`            | Time signature (beats per bar)                                                                                         |
| `bars`                           | `8`            | Bars per section                                                                                                       |
| `volume`                         | `0.3`          | Master volume, 0..1                                                                                                    |
| `evolve`                         | `true`         | Re-draw melodies each pass through the form; `false` repeats the form verbatim                                         |
| `humanize`                       | `true`         | Subtle off-grid timing + velocity, for a human feel                                                                    |
| `chromatic`                      | `true`         | Allow occasional borrowed (non-diatonic) chords in bright-major keys                                                   |
| `voices`                         | all on         | Toggle parts, e.g. `{ pad: false, drums: false }`                                                                      |
| `parent` / `raga`                | from style     | A `Scale` from `SCALES` (e.g. `SCALES.major`, `SCALES.mohanam`); pair so `raga ⊆ parent`                               |
| `groove`                         | from style     | `straight` \| `fourOnFloor` \| `halfTime` \| `soft` \| `busy` \| `syncopated` \| `breakbeat` \| `halfDouble` \| `none` |
| `rootMidi` / `density` / `swing` | from style     | Tonic MIDI note 36–84; `density` & `swing` are 0..1                                                                    |
| `kit`                            | `"default"`    | Drum kit                                                                                                               |
| `audioContext`                   | created lazily | Bring your own `AudioContext` (or a compatible one)                                                                    |

## Render / export a track

Bake a track offline (faster than realtime) to a buffer or a WAV — handy for
shipping a loop as an asset:

```ts
import { renderOffline, encodeWav } from "@simpllyf/ditty";

// `loops` renders to exact form boundaries (gapless); or pass `seconds`.
const { sampleRate, channels } = await renderOffline({
  style: "dreamy",
  seed: 7,
  loops: 4,
});

const wav = encodeWav(channels, sampleRate); // Uint8Array (stereo)
// browser: new Blob([wav], { type: "audio/wav" })
// node:    fs.writeFileSync("track.wav", wav)
```

`renderOffline` takes the same musical options as the engine, plus:

- `seconds` **or** `loops` — exactly one (`loops` renders the whole form to an exact, gapless boundary).
- `sampleRate` — output rate, default `44100`.
- `volume` — master volume, default `0.8` (offline can run a touch hotter than realtime).

`channels` is `[left, right]` — two `Float32Array`s; `encodeWav` interleaves them.

## Browser autoplay

Browsers block audio until a user gesture. Call **`start()` from a click/tap**:

```js
playButton.addEventListener("click", () => engine.start());
```

If `start()` is called outside a gesture it resolves but stays silent (it does
not throw); the next `start()` from a real gesture begins playback.

## Framework integration

Ditty ships no framework code — it stays DOM- and framework-free.

```jsx
// React
const engine = useMemo(() => createEngine({ style: "playful" }), []);
useEffect(() => () => engine.dispose(), [engine]);
return <button onClick={() => engine.start()}>Sound on</button>;
```

```svelte
<!-- Svelte -->
<script>
  import { createEngine } from "@simpllyf/ditty";
  const engine = createEngine();
  onDestroy(() => engine.dispose());
</script>
<button on:click={() => engine.start()}>Sound on</button>
```

## The pure core

The whole composition pipeline is pure, deterministic, and importable on its own
at `@simpllyf/ditty/core` — for tests, previews, analysis, or building your own
playback layer. No audio involved:

```ts
import { createSession, arrange, makeRng, SCALES } from "@simpllyf/ditty/core";

// The seed→music brain: pick the band + build the form once, then pull Scores.
const session = createSession({ seed: 1234, style: "cinematic" });
session.sections; // the form: [{ label: "A", keyShift, arpRole }, ...]
const score = session.nextScore(); // the next section, as play-ready data
// score.parts → [{ voice: "lead", notes: [{ startBeat, durationBeats, freq, velocity }] }, ...]
// score.drums → [{ startBeat, drum: "kick" | "snare" | "hat", velocity }]

// …or compose a single Score directly, without the form/session:
arrange({ rng: makeRng(1234), raga: SCALES.mohanam });
```

`/core` also exports the building blocks — `generateHarmony`, `generateMelody`,
`pickStyle`, `SCALES`, `INSTRUMENTS`, `DRUM_GROOVES`, and the pure `encodeWav`.

## Your music is yours

Ditty generates music algorithmically from **uncopyrightable building blocks**
(scales, ragas, chords, common progressions — all public domain), with no
samples and no training data. Tracks you generate are yours to use freely, for
any purpose, commercial or not. The Ditty **code** is MIT-licensed.

## What it's good at (and not)

- **Good at:** coherent, pleasant, endlessly varied background music for apps and
  games — harmony that resolves, melodies that sit on the chords, multiple
  instruments and grooves, seamless looping.
- **Not:** a hand-composed, memorable signature theme. It sounds genuinely
  _musical_, but a hook your players will hum is still a human job.

## Development

Requires [`mise`](https://mise.jdx.dev) (pins Node, pnpm, and just).

```sh
mise install
just setup   # install dependencies
just check   # format, lint, typecheck, test, build, zero-dep + size gates
just e2e     # cross-browser audio tests (Playwright)
```

## License

[MIT](./LICENSE) © Simpllyf
