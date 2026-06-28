/**
 * `@simpllyf/ditty` — the audio engine entry. Construct an engine, start it from
 * a user gesture, and it plays endless, seamlessly-looping generative music.
 *
 * ```ts
 * import { createEngine } from "@simpllyf/ditty";
 * const engine = createEngine({ raga: SCALES.mohanam });
 * playButton.addEventListener("click", () => engine.start()); // start from a gesture
 * ```
 *
 * The pure composition layer (no Web Audio) is available at `@simpllyf/ditty/core`.
 */
export { createEngine } from "./engine";
export type { Engine, EngineOptions, EngineAudioContext } from "./engine";
export { renderOffline, encodeWav } from "./render";
export type { RenderOptions, RenderResult, OfflineContextLike } from "./render";

// Composition + config knobs, re-exported for convenience.
export { arrange } from "./compose/arranger";
export type {
  Score,
  ScoreNote,
  ScorePart,
  ScoreVoice,
  DrumHit,
  DrumName,
  ArrangeOptions,
} from "./compose/arranger";
export { SCALES } from "./theory/scales";
export type { Scale, ScaleName } from "./theory/scales";
export { DRUM_GROOVES } from "./theory/rhythm";
export type { DrumGrooveName } from "./theory/rhythm";
export { INSTRUMENTS, instrumentsForVoice } from "./instruments";
export type { Instrument, InstrumentName } from "./instruments";
export { STYLES } from "./styles";
export type { Style, StyleName } from "./styles";
export { makeRng } from "./rng";
export type { Rng } from "./rng";
