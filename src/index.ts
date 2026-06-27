/**
 * Public entry point — `@simpllyf/ditty`.
 *
 * This will expose the audio engine facade (`createPeppyEngine`) once the
 * scheduler and synth layers land. Until then it re-exports the pure layer so
 * the package resolves; the pure layer is also available on its own at
 * `@simpllyf/ditty/core`.
 */
export * from "./core";
