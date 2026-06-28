import { describe, expect, it } from "vitest";
import { DEFAULT_ROOT_MIDI, midiToFrequency, semitoneToFrequency } from "../src/theory/pitch";

describe("midiToFrequency", () => {
  it("A4 (MIDI 69) is 440 Hz", () => {
    expect(midiToFrequency(69)).toBe(440);
  });

  it("middle C (MIDI 60) is ~261.63 Hz", () => {
    expect(midiToFrequency(60)).toBeCloseTo(261.6256, 3);
  });

  it("an octave up doubles the frequency", () => {
    expect(midiToFrequency(72) / midiToFrequency(60)).toBeCloseTo(2, 10);
  });
});

describe("semitoneToFrequency", () => {
  it("uses rootMidi for the absolute pitch", () => {
    expect(semitoneToFrequency(0, 69)).toBe(440);
    expect(semitoneToFrequency(9, 60)).toBe(440); // 60 + 9 = 69
  });

  it("an octave up doubles the frequency", () => {
    expect(semitoneToFrequency(12, 60) / semitoneToFrequency(0, 60)).toBeCloseTo(2, 10);
  });

  it("defaults the root to middle C", () => {
    expect(semitoneToFrequency(0)).toBe(semitoneToFrequency(0, DEFAULT_ROOT_MIDI));
    expect(DEFAULT_ROOT_MIDI).toBe(60);
  });
});
