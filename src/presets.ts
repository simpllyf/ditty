/**
 * The "peppy" mood and the reward stingers.
 *
 * v1 ships a single mood. The preset is just a parameter bundle the engine
 * feeds to the melody/synth/scheduler; stingers are short, fixed flourishes
 * played over the bed through their own voices.
 */
import type { Voice } from "./melody";
import { SCALES, type Scale } from "./scale";

/** Parameters that define a mood. */
export interface Preset {
  readonly scale: Scale;
  /** MIDI note of the tonic (the lead's register). */
  readonly rootMidi: number;
  /** Tempo in BPM. */
  readonly tempo: number;
  /** Default master volume, 0..1. */
  readonly volume: number;
  /** Lead range in scale degrees. */
  readonly range: readonly [number, number];
  /** Contour amplitude in scale degrees. */
  readonly contourAmplitude: number;
  /** Include the bass layer. */
  readonly bass: boolean;
  /** Include the light arpeggio layer. */
  readonly arp: boolean;
}

/** Bright, bouncy, major-pentatonic game-feel. The only mood in v1. */
export const PEPPY: Preset = {
  scale: SCALES.majorPentatonic,
  rootMidi: 72, // C5
  tempo: 128,
  volume: 0.4,
  range: [0, 7],
  contourAmplitude: 4,
  bass: true,
  arp: true,
};

/** The reward moments a stinger can mark. */
export type StingerName = "correct" | "levelup" | "win";

/** One note of a stinger, relative to the trigger time and the stinger root. */
export interface StingerNote {
  /** Scale degree from {@link STINGER_ROOT_MIDI}. */
  readonly degree: number;
  /** Seconds after the stinger is triggered. */
  readonly timeOffset: number;
  readonly durationSeconds: number;
  readonly velocity: number;
  readonly voice: Voice;
}

/** Stingers sit a little above the lead register so they cut through the bed. */
export const STINGER_ROOT_MIDI = 84; // C6

const arp = (
  degree: number,
  timeOffset: number,
  velocity: number,
  durationSeconds = 0.1,
): StingerNote => ({
  degree,
  timeOffset,
  durationSeconds,
  velocity,
  voice: "arp",
});

/**
 * Fixed flourishes — fast ascending pentatonic arpeggios that grow with the
 * size of the reward. Degrees are pentatonic indices (5 = the tonic an octave up).
 */
export const STINGERS: Record<StingerName, readonly StingerNote[]> = {
  // A quick three-note lift.
  correct: [arp(0, 0, 0.7), arp(2, 0.08, 0.7), arp(4, 0.16, 0.8, 0.18)],
  // A longer run up to the octave-and-a-third.
  levelup: [
    arp(0, 0, 0.7),
    arp(2, 0.07, 0.72),
    arp(4, 0.14, 0.75),
    arp(5, 0.21, 0.8),
    arp(7, 0.28, 0.85, 0.24),
  ],
  // The full run, a held top note, and a low root for body.
  win: [
    arp(0, 0, 0.7),
    arp(2, 0.07, 0.74),
    arp(4, 0.14, 0.78),
    arp(5, 0.21, 0.82),
    arp(7, 0.28, 0.9, 0.5),
    { degree: -5, timeOffset: 0, durationSeconds: 0.5, velocity: 0.5, voice: "bass" },
  ],
};
