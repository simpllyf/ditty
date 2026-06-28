/**
 * Pitch math — the bridge from abstract semitones to Hz. Pure.
 */

/** MIDI note number of A4, the equal-temperament reference. */
const A4_MIDI = 69;
/** Frequency of A4 in Hz. */
const A4_HZ = 440;
/** Semitones per octave. */
export const OCTAVE = 12;

/** Default root: middle C (MIDI 60). A bright, neutral key. */
export const DEFAULT_ROOT_MIDI = 60;

/** Pitch class (0–11) of a semitone value, wrapping any integer into one octave. */
export function pitchClass(semitone: number): number {
  return ((semitone % OCTAVE) + OCTAVE) % OCTAVE;
}

/** Equal-temperament frequency, in Hz, of a MIDI note number. */
export function midiToFrequency(midi: number): number {
  return A4_HZ * 2 ** ((midi - A4_MIDI) / OCTAVE);
}

/**
 * Equal-temperament frequency, in Hz, of a semitone offset from a root MIDI
 * note: `440 * 2^((rootMidi + semitone - 69) / 12)`.
 */
export function semitoneToFrequency(
  semitone: number,
  rootMidi: number = DEFAULT_ROOT_MIDI,
): number {
  return midiToFrequency(rootMidi + semitone);
}
