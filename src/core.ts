/**
 * Pure layer — `@simpllyf/ditty/core`.
 *
 * Everything exported here is side-effect-free and runs in plain Node with no
 * `AudioContext`: the seeded PRNG, scales, and (in later layers) the melody
 * stream. Import this entry point for testing, previewing, or building your own
 * playback shell. The audio engine itself lives at `@simpllyf/ditty`.
 */
export { makeRng } from "./rng";
export type { Rng } from "./rng";
export {
  SCALES,
  DEFAULT_ROOT_MIDI,
  degreeToSemitone,
  semitoneToFrequency,
  degreeToFrequency,
} from "./scale";
export type { Scale, ScaleName } from "./scale";
