# Ditty

**A zero-dependency, framework-agnostic generative music engine for the browser.**

Ditty produces endless, non-repetitive, _peppy_ game-feel background music plus
one-shot reward stingers — entirely synthesized through the Web Audio API. No
audio files, no samples, no frameworks. Built for kid-friendly learning apps,
but standalone and reusable anywhere.

```
┌── pure brain (runs in Node, no audio) ──┐   ┌── thin audio shell ──┐
   rng → scale → rhythm → constraints → melody  →  scheduler → synth  →  🔊
└─────────────────────────────────────────┘   └──────────────────────┘
```

- **Endless & pleasant.** A pentatonic scale plus a few hard musical
  constraints (leap caps, phrase resolution, anti-repeat) keep it cheerful over
  long sessions without ever turning into noise.
- **Zero runtime dependencies.** Web Audio is the only thing it needs — enforced
  in CI.
- **Deterministic.** One seeded PRNG drives everything. Same seed → identical
  music, byte-for-byte. The whole musical brain runs and is tested in Node with
  no `AudioContext`.
- **Tiny.** ~5 KB min+gzip for the full engine, tree-shakeable, side-effect-free.
- **Framework-agnostic.** No DOM access, no framework imports. Vanilla, React,
  Vue, Svelte — identical.

> **Pre-release (0.0.x).** The engine is complete, thoroughly unit-tested, and
> validated end-to-end in Chromium, Firefox, and WebKit (real Web Audio output),
> pending the first npm publish.

## Install

```sh
npm install @simpllyf/ditty
```

Or drop it into a plain HTML page with no build step:

```html
<script src="https://unpkg.com/@simpllyf/ditty"></script>
<script>
  const engine = Ditty.createPeppyEngine();
  document.querySelector("button").addEventListener("click", () => engine.start());
</script>
```

## Usage

```ts
import { createPeppyEngine } from "@simpllyf/ditty";

const engine = createPeppyEngine({
  seed: 1234, // omit for a fresh random feel each session
  tempo: 128, // BPM
  volume: 0.4, // 0..1 — it's background music, keep it quiet
});

// MUST be called from a user gesture (click/tap/keydown) — see below.
await engine.start();

engine.stinger("correct"); // "correct" | "levelup" | "win" — layers over the music
engine.setVolume(0.3);
engine.pause(); // suspend audio, keep state
engine.resume();
engine.stop(); // stop and silence, keep the context for a later start()
engine.dispose(); // tear down nodes, release the context
```

### Options

| Option         | Default        | Notes                                                       |
| -------------- | -------------- | ----------------------------------------------------------- |
| `seed`         | random         | Set for a reproducible stream; omit for variety per session |
| `tempo`        | `128`          | Beats per minute                                            |
| `volume`       | `0.4`          | Master volume, 0..1                                         |
| `audioContext` | created lazily | Bring your own `AudioContext` (or a compatible one)         |

## Browser autoplay

Browsers block audio until a user gesture. Call **`start()` from a click/tap**:

```js
playButton.addEventListener("click", () => engine.start());
```

If `start()` is called outside a gesture it resolves but stays silent (it does
not throw); the next `start()` from a real gesture begins playback.

## Framework integration

Ditty ships no framework code — it stays DOM- and framework-free. A few patterns:

**React**

```jsx
const engine = useMemo(() => createPeppyEngine(), []);
useEffect(() => () => engine.dispose(), [engine]);
return <button onClick={() => engine.start()}>Sound on</button>;
```

**Vue**

```vue
<script setup>
const engine = createPeppyEngine();
onUnmounted(() => engine.dispose());
</script>
<template><button @click="engine.start()">Sound on</button></template>
```

**Svelte**

```svelte
<script>
  const engine = createPeppyEngine();
  onDestroy(() => engine.dispose());
</script>
<button on:click={() => engine.start()}>Sound on</button>
```

## The pure core

The musical brain is pure, deterministic, and importable on its own — handy for
tests, previews, or building your own playback layer. No audio involved:

```ts
import { makeRng, SCALES, MelodyStream } from "@simpllyf/ditty/core";

const stream = new MelodyStream({ rng: makeRng(1234), scale: SCALES.majorPentatonic });
const notes = stream.next(); // NoteEvent[] — { startBeat, durationBeats, frequency, velocity, voice }
```

## What it's good at (and not)

- **Good at:** unobtrusive, cheerful, endlessly varied background music and
  satisfying reward stingers; never grating, thanks to the anti-repeat and
  phrase-variation constraints.
- **Not:** a composed, memorable theme. There is no "hook." The pentatonic scale
  plus leap caps and phrase resolution are why it reliably sounds _fine_ rather
  than random — if your app needs a signature melody, that's a human job.

## Development

Requires [`mise`](https://mise.jdx.dev) (pins Node, pnpm, and just).

```sh
mise install
just setup   # install dependencies
just check   # format, lint, typecheck, test, build, zero-dep + size gates
```

## License

[MIT](./LICENSE) © Simpllyf
