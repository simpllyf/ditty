# CLAUDE.md — Ditty Working Agreement

## Project

Ditty is a zero-dependency, framework-agnostic generative music engine for the
browser: endless, harmony-led, multi-instrument background music — pick a _style_
and it arranges a lead, bass, pad, arpeggio, and drums that follow the chords —
all synthesized via the Web Audio API. Published as `@simpllyf/ditty` (OSS, MIT).
Reference consumer is the `learnwithoslo` kids' learning app, but the library is
standalone.

## The one architectural rule

**Pure brain, thin shell.** All musical decision-making is pure — data in, data
out, no side effects, no Web Audio:

```
src/rng constraints noise wav voices instruments styles session  ← PURE (Node, no audio)
src/theory/{pitch scales chords progressions rhythm}             ← PURE — music theory
src/compose/{harmony melody arranger}                            ← PURE — composition → Score
src/audio/{synth scheduler loop engine render}                   ← thin Web-Audio shell
src/index.ts (engine)   src/core.ts (pure layer)                ← entry points
```

- The pure layer must run in Node with **no `AudioContext`** and is exhaustively
  tested there. `src/audio/synth.ts` is the _only_ file that creates Web Audio
  nodes; an eslint `no-restricted-imports` rule forbids the pure layer from
  importing `src/audio/*`, so the boundary can't erode.
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
- **Pleasant by constraint, not cleverness.** Coherence comes from functional
  harmony, in-key ragas (raga ⊆ parent), leap caps, chord tones on strong beats,
  cadences, and anti-repeat — not from a "smarter" model. Resist adding one.
- **Curated variety, not a free-for-all.** Ships a few named **styles**
  (peppy/calm/playful/dreamy) — each a vetted pool of scale pairings, grooves,
  tempo/feel ranges, and instruments. Add styles/instruments as DATA (registries
  in `styles.ts`/`instruments.ts`); they auto-join the randomizer. Don't grow the
  count without reason, and keep every raga ⊆ its parent.

## How we work

- Pras has final product call. Push back on weak architecture or scope drift.
- Ship in small, independently green PRs to `main`. Each PR = one layer with its
  tests. Keep history truly incremental and high-quality.
- Tests are first-class: pure invariants (property-based, any seed) + golden
  snapshots + shell coverage against the fake `AudioContext`. "Done" means the
  invariants are asserted and snapshots are committed.
- Don't edit unrelated files or revert user changes.

## Comments

A comment is a long-term liability — it must keep earning its place every time
someone reads the code, long after the change that prompted it.

- **Explain _why_, not _what_.** Comment intent, non-obvious constraints,
  invariants, gotchas, and the reason a surprising choice is correct. Never
  restate what the code already says.
- **No change-narration.** Comments must read as if the code was always this way.
  No history, no WIP notes, no "now/previously/used to/was X", no "(unchanged)",
  no PR/issue/step/phase references. That context is real but belongs on the PR
  and commit message — where it's dated and discoverable — not in the source,
  where it rots into a lie.
- **Stay true under change.** Don't write a comment that a future edit will
  silently falsify. If a comment would need updating whenever nearby code does,
  it's probably describing _what_, not _why_.
- **Be concise and well-placed.** One sharp line beats a paragraph; put it on the
  thing it explains. Prefer a clear name or type over a comment.
- Stable, documented concept names (e.g. "gentle evolve", "raga ⊆ parent") are
  fine as labels — they're vocabulary, not history.

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
