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
export { DEFAULT_ROOT_MIDI, OCTAVE, semitoneToFrequency, midiToFrequency } from "./theory/pitch";
export { SCALES, degreeToSemitone, degreeToFrequency, degreePitchClass } from "./theory/scales";
export type { Scale, ScaleName } from "./theory/scales";
export {
  CHORD_QUALITIES,
  chordPitchClasses,
  makeChord,
  diatonicChord,
  isChordTone,
  chordQualityOf,
  romanNumerals,
} from "./theory/chords";
export type { Chord, ChordQuality } from "./theory/chords";
export { PROGRESSIONS, FUNCTION_OF, functionalProgression } from "./theory/progressions";
export type { ProgressionName, HarmonicFunction } from "./theory/progressions";
export { generateHarmony, chordTonesInScale } from "./compose/harmony";
export type { HarmonicPlan, HarmonicBar, HarmonyOptions } from "./compose/harmony";
export {
  STEPS_PER_BEAT,
  metricStrength,
  melodyRhythm,
  DRUM_GROOVES,
  fitGroove,
  applySwing,
  SWING_MAX,
} from "./theory/rhythm";
export type { Onset, DrumGroove, DrumGrooveName } from "./theory/rhythm";
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
export { MelodyStream } from "./melody";
export type { NoteEvent, Voice, MelodyOptions } from "./melody";
