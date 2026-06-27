# CLAUDE.md — Ditty Working Agreement

## Project

Ditty is a zero-dependency, framework-agnostic generative music engine for the
browser: endless _peppy_ background music plus one-shot reward stingers, all
synthesized via the Web Audio API. Published as `@simpllyf/ditty` (OSS, MIT).
Reference consumer is the `learnwithoslo` kids' learning app, but the library is
standalone.

## The one architectural rule

**Pure brain, thin shell.** All musical decision-making is pure — data in, data
out, no side effects, no Web Audio:

```
src/rng.ts  scale.ts  rhythm.ts  constraints.ts  melody.ts   ← PURE (Node, no audio)
src/synth.ts  scheduler.ts                                    ← thin Web-Audio shell
src/presets.ts  engine.ts                                     ← glue / public facade
src/index.ts (engine)   src/core.ts (pure layer)             ← entry points
```

- The pure layer must run in Node with **no `AudioContext`** and is exhaustively
  tested there. `synth.ts` is the _only_ file that creates Web Audio nodes.
- `synth`/`scheduler` take an **injected** `AudioContext` and clock — never
  reference the global `AudioContext`. That is what makes them testable against a
  `FakeAudioContext`.

## Non-negotiables

- **Zero runtime dependencies.** Web Audio only. CI fails on any
  `dependencies` entry (`scripts/check-no-deps.mjs`).
- **Determinism.** All randomness flows through the seeded `Rng` (`makeRng`).
  **Never `Math.random()`** anywhere — eslint blocks it. Same seed → identical
  event stream; golden snapshots guard this.
- **Side-effect-free.** No top-level work runs on import. `sideEffects: false`.
- **Size budget < 10 KB min+gzip** for the full engine (`just size`).
- **Pleasant by constraint, not cleverness.** Pentatonic scale + leap caps +
  phrase resolution + anti-repeat. Resist adding a "smarter" model.
- v1 ships **one mood ("peppy")**. The architecture allows more later — do not
  build them now. Do not silently shrink scope.

## How we work

- Pras has final product call. Push back on weak architecture or scope drift.
- Ship in small, independently green PRs to `main`. Each PR = one layer with its
  tests. Keep history truly incremental and high-quality.
- Tests are first-class: pure invariants (property-based, any seed) + golden
  snapshots + shell coverage against the fake `AudioContext`. "Done" means the
  invariants are asserted and snapshots are committed.
- Don't edit unrelated files or revert user changes.

## Stack & commands

- TypeScript, ESM. Build with `tsup` (ESM + `.d.ts` + a minified IIFE global for
  `<script>` use). Two entries: `@simpllyf/ditty` and `@simpllyf/ditty/core`.
- pnpm (not npm/yarn), `mise` for the toolchain (`.mise.toml`), `just` as the
  command surface. ESLint flat config + Prettier. Vitest (+ fast-check for
  property tests). Playwright for cross-browser e2e.

```sh
just setup       # pnpm install --frozen-lockfile
just check       # format-check, lint, typecheck, test, build, deps-check, size
just test        # vitest run
just build       # tsup
```

Run `just check` before every push; it is exactly what CI runs.
