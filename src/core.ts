/**
 * Pure layer — `@simpllyf/ditty/core`.
 *
 * Everything exported here is side-effect-free and runs in plain Node with no
 * `AudioContext`: the seeded PRNG, music theory, the composition pipeline
 * (harmony → melody → arranger → Score), and the instrument/drum patch data.
 * Import this to test, preview, analyze, or build your own playback shell. The
 * audio engine itself lives at `@simpllyf/ditty`.
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

export { generateHarmony, chordTonesInScale } from "./compose/harmony";
export type { HarmonicPlan, HarmonicBar, HarmonyOptions } from "./compose/harmony";
export { generateMelody } from "./compose/melody";
export type { MelodyNote, MelodyOptions } from "./compose/melody";
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

export { INSTRUMENTS, instrumentsForVoice, REVERB_SEND_BY_VOICE, DRUM_KITS } from "./instruments";
export type {
  Instrument,
  InstrumentName,
  OscKind,
  OscLayer,
  AmpEnv,
  FilterPatch,
  DrumVoice,
  DrumKitName,
} from "./instruments";
export { makeNoiseTable, DEFAULT_NOISE_LENGTH } from "./noise";
export { STYLES, pickStyle } from "./styles";
export type { Style, ChosenStyle, StyleName, ScaleKey } from "./styles";
export { encodeWav } from "./wav";

// The seed→music brain (pure: no AudioContext) — the base of EngineOptions /
// RenderOptions, and what you need to build your own playback shell.
export { createSession } from "./session";
export type { Session, SessionOptions } from "./session";

export {
  DEFAULT_MAX_LEAP,
  DEFAULT_MAX_NOTE_REPEAT,
  isWithinLeap,
  capLeap,
  contourTarget,
  exceedsRepeatLimit,
  ShuffleBag,
} from "./constraints";
export type { ContourShape } from "./constraints";
