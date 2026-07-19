/**
 * The closing cadence — what a piece plays to END rather than to carry on.
 *
 * Endless music has no ending of its own, so this is the one thing the engine
 * plays that is not part of the cycle: the harmony arrives home on the tonic, the
 * drums and the running figures drop away, and a single held chord is left to ring
 * out. Resolution, then decay — the two things an ear reads as "that was the end"
 * rather than "the sound stopped".
 *
 * Pure and deterministic, like every other musical decision: the audio layer only
 * schedules what this returns.
 */
import { OCTAVE, midiToFrequency } from "../theory/pitch";
import { type Scale, degreeToFrequency } from "../theory/scales";
import { diatonicChord } from "../theory/chords";
import type { Score } from "./arranger";

export interface ClosingOptions {
  /** Harmony parent — the tonic chord is built from it. */
  readonly parent: Scale;
  /** Melody raga — the lead resolves to its tonic. */
  readonly raga: Scale;
  readonly rootMidi: number;
  readonly bpm: number;
  readonly beatsPerBar: number;
}

/** Bars the closing chord is held for before it is left to decay. */
export const CLOSING_BARS = 2;

/**
 * A held tonic chord: bass, pad and lead arriving together and sustaining. No
 * drums and no arpeggio — a piece that stops pulsing is a piece that has finished,
 * and a lone percussive hit with nothing after it reads as a cut, not a close.
 */
export function closingScore(o: ClosingOptions): Score {
  // Velocities sit UNDER a playing bar's: three voices arriving together and
  // sustaining already sum to more than the music they follow, and an ending that
  // jumps in level reads as a jolt rather than as an arrival.
  const { parent, raga, rootMidi, bpm, beatsPerBar } = o;
  const lengthBeats = CLOSING_BARS * beatsPerBar;
  const tonic = diatonicChord(parent, 0);
  const held = { startBeat: 0, durationBeats: lengthBeats };

  return {
    bpm,
    beatsPerBar,
    bars: CLOSING_BARS,
    lengthBeats,
    rootMidi,
    parts: [
      {
        voice: "lead",
        // The upper tonic, where the lead has been singing all along — arriving in a
        // register it never used would read as a new idea, not a conclusion.
        notes: [{ ...held, freq: degreeToFrequency(raga, raga.length, rootMidi), velocity: 0.38 }],
      },
      {
        voice: "bass",
        notes: [{ ...held, freq: midiToFrequency(rootMidi - OCTAVE), velocity: 0.45 }],
      },
      {
        voice: "pad",
        // Root position: the plainest possible statement of the chord, which is what
        // an ending wants — the pad spends the whole piece avoiding it.
        notes: tonic.pcs.map((pc) => ({
          ...held,
          freq: midiToFrequency(rootMidi + tonic.root + ((pc - tonic.root + OCTAVE) % OCTAVE)),
          velocity: 0.26,
        })),
      },
    ],
    drums: [],
  };
}
