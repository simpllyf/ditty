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
- **Tiny.** Budgeted under 10 KB min+gzip, tree-shakeable, side-effect-free.
- **Framework-agnostic.** No DOM access, no framework imports. Vanilla, React,
  Vue, Svelte — identical.

> **Status: under active, incremental construction.** The package is being built
> layer by layer (see the roadmap). The pure core (`@simpllyf/ditty/core`) is
> usable today; the audio engine facade lands as the scheduler and synth layers
> arrive.

## Install

```sh
npm install @simpllyf/ditty
```

## The pure core, today

The musical brain is pure and deterministic — handy for tests, previews, or
building your own playback layer:

```ts
import { makeRng } from "@simpllyf/ditty/core";

const rng = makeRng(1234); // same seed → same stream, every run
rng.next(); // float in [0, 1)
rng.int(6); // integer in [0, 6)
rng.pick(["c", "e", "g"]); // uniform choice
rng.weighted(["eighth", "quarter"], [3, 1]); // weighted choice

// Independent, uncorrelated sub-streams for parallel concerns:
const melodyRng = rng.fork();
const rhythmRng = rng.fork();
```

## Engine API (target)

The public facade, assembled over the coming layers:

```ts
import { createPeppyEngine } from "@simpllyf/ditty";

const engine = createPeppyEngine({ tempo: 128, volume: 0.4 });

await engine.start(); // call from a click/tap — browsers block audio until a user gesture
engine.stinger("correct"); // one-shot reward flourish, layered over the music
engine.setVolume(0.3);
engine.pause();
engine.resume();
engine.stop();
engine.dispose();
```

## Roadmap

| Layer                           | Status |
| ------------------------------- | ------ |
| `rng` — seeded PRNG             | ✅     |
| `scale` — pitch                 | ⏳     |
| `rhythm` — time                 | ⏳     |
| `constraints` — musicality      | ⏳     |
| `melody` — the brain            | ⏳     |
| `synth` — Web Audio voices      | ⏳     |
| `scheduler` — look-ahead timing | ⏳     |
| `engine` + presets + stingers   | ⏳     |
| cross-browser e2e + size gate   | ⏳     |

## Development

Requires [`mise`](https://mise.jdx.dev) (pins Node, pnpm, and just).

```sh
mise install
just setup   # install dependencies
just check   # format, lint, typecheck, test, build, zero-dep + size gates
```

## License

[MIT](./LICENSE) © Simpllyf
