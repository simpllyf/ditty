/**
 * Public entry point — `@simpllyf/ditty`.
 *
 * The audio engine facade. For the pure, deterministic layer (PRNG, scales,
 * melody stream — no audio), import `@simpllyf/ditty/core` instead.
 *
 * ```ts
 * import { createPeppyEngine } from "@simpllyf/ditty";
 * const engine = createPeppyEngine();
 * playButton.addEventListener("click", () => engine.start()); // start from a gesture
 * engine.stinger("correct");
 * ```
 */
export { createPeppyEngine } from "./engine";
export type { EngineOptions, EngineAudioContext, PeppyEngine } from "./engine";
export type { StingerName } from "./presets";
