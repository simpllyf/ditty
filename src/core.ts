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
export {
  DEFAULT_RHYTHM,
  barLengthSteps,
  stepsToBeats,
  weightedDuration,
  generateBar,
} from "./rhythm";
export type { RhythmConfig, DurationWeight } from "./rhythm";
export {
  DEFAULT_MAX_LEAP,
  DEFAULT_MAX_NOTE_REPEAT,
  STABLE_PITCH_CLASSES,
  isWithinLeap,
  capLeap,
  isStableDegree,
  nearestStableDegree,
  contourTarget,
  exceedsRepeatLimit,
  ShuffleBag,
} from "./constraints";
export type { ContourShape } from "./constraints";
