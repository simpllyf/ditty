/**
 * `@simpllyf/ditty` — the audio engine entry. Construct an engine, start it from
 * a user gesture, and it plays endless, seamlessly-looping generative music.
 *
 * ```ts
 * import { createEngine } from "@simpllyf/ditty";
 * const engine = createEngine({ style: "calm" });
 * playButton.addEventListener("click", () => engine.start()); // start from a gesture
 * ```
 *
 * The pure composition layer (no Web Audio) is available at `@simpllyf/ditty/core`.
 */
// Audio shell — the realtime engine, the offline renderer, and the Web-Audio
// port types for bring-your-own-context.
export { createEngine } from "./audio/engine";
export type { Engine, EngineOptions, EngineAudioContext } from "./audio/engine";
export { renderOffline, encodeWav } from "./audio/render";
export type { RenderOptions, RenderResult, OfflineContextLike } from "./audio/render";
export type { AudioContextLike } from "./audio/synth";

// A curated slice of the pure brain — the config knobs + the Session/Score types an
// engine user touches. The FULL pure surface (theory, constraints, all registries)
// lives at `@simpllyf/ditty/core`; we keep this entry lean for the size budget.
export { createSession } from "./session";
export type { Session, SessionOptions } from "./session";
export { arrange } from "./compose/arranger";
export type {
  Score,
  ScoreNote,
  ScorePart,
  ScoreVoice,
  DrumHit,
  DrumName,
  ArrangeOptions,
  VoiceToggles,
} from "./compose/arranger";
export { SCALES } from "./theory/scales";
export type { Scale, ScaleName } from "./theory/scales";
export { DRUM_GROOVES } from "./theory/rhythm";
export type { DrumGrooveName } from "./theory/rhythm";
export { INSTRUMENTS, instrumentsForVoice, DRUM_KITS } from "./instruments";
export type { Instrument, InstrumentName, DrumVoice, DrumKitName } from "./instruments";
export { STYLES } from "./styles";
export type { Style, StyleName } from "./styles";
export { makeRng } from "./rng";
export type { Rng } from "./rng";
