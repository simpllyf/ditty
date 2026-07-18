import { describe, expect, it } from "vitest";
import type { DrumName } from "../src/voices";
import {
  DRUM_KITS,
  INSTRUMENTS,
  tuneKit,
  type DrumVoice,
  type Instrument,
  REVERB_SEND_BY_VOICE,
  instrumentsForVoice,
} from "../src/instruments";
import type { ScoreVoice } from "../src/compose/arranger";

const VOICES: ScoreVoice[] = ["lead", "bass", "pad", "arp"];
const OSC_KINDS = ["sine", "triangle", "sawtooth", "square"];
const PATCHES = Object.entries(INSTRUMENTS) as Array<[string, Instrument]>;

describe("INSTRUMENTS registry", () => {
  it.each(PATCHES)("%s is a well-formed patch", (name, inst) => {
    expect(inst.name).toBe(name);
    expect(inst.voices.length).toBeGreaterThan(0);
    for (const v of inst.voices) expect(VOICES).toContain(v);
    expect(inst.layers.length).toBeGreaterThan(0);
    for (const l of inst.layers) {
      expect(OSC_KINDS).toContain(l.kind);
      expect(l.ratio === undefined || l.ratio > 0).toBe(true);
      expect(l.gain === undefined || (l.gain >= 0 && l.gain <= 1)).toBe(true);
    }
    const { attack, decay, sustain, release } = inst.amp;
    expect(Math.min(attack, decay, sustain, release)).toBeGreaterThanOrEqual(0);
    expect(sustain).toBeLessThanOrEqual(1);
    expect(inst.filter === undefined || inst.filter.cutoff > 0).toBe(true);
    expect(inst.gain === undefined || (inst.gain > 0 && inst.gain <= 1)).toBe(true);
    expect(inst.reverbSend === undefined || (inst.reverbSend >= 0 && inst.reverbSend <= 1)).toBe(
      true,
    );
  });
});

describe("instrumentsForVoice", () => {
  it.each(VOICES)("returns a non-empty pool for %s, all tagged for it", (voice) => {
    const names = instrumentsForVoice(voice);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(INSTRUMENTS[n].voices).toContain(voice);
  });
});

describe("REVERB_SEND_BY_VOICE & DRUM_KITS", () => {
  it("has an in-range reverb send for every voice", () => {
    for (const v of VOICES) {
      expect(REVERB_SEND_BY_VOICE[v]).toBeGreaterThanOrEqual(0);
      expect(REVERB_SEND_BY_VOICE[v]).toBeLessThanOrEqual(1);
    }
  });

  it("default kit has a well-formed kick/snare/hat", () => {
    for (const drum of ["kick", "snare", "hat"] as const) {
      const v = DRUM_KITS.default[drum];
      expect(v.gain).toBeGreaterThan(0);
      expect(v.ampDecay).toBeGreaterThan(0);
    }
  });
});

describe("tuneKit", () => {
  const midiOf = (freq: number) => Math.round(69 + 12 * Math.log2(freq / 440));
  const pc = (n: number) => ((n % 12) + 12) % 12;
  /** The pitch a drum is heard at: where a sweep settles, or a mixed voice's tone. */
  const bodyOf = (voice: DrumVoice): number =>
    voice.kind === "tone" ? voice.freqEnd : voice.kind === "mixed" ? voice.freqStart : 0;
  const kit = (rootMidi: number): Record<DrumName, DrumVoice> =>
    tuneKit(DRUM_KITS.default, rootMidi);
  const PITCHED: DrumName[] = ["kick", "snare"];

  it("lands every pitched drum on the tonic or the fifth, in every key", () => {
    for (let rootMidi = 48; rootMidi < 60; rootMidi++) {
      for (const drum of PITCHED) {
        const interval = pc(midiOf(bodyOf(kit(rootMidi)[drum])) - rootMidi);
        expect([0, 7]).toContain(interval); // consonant — never a flat second or tritone
      }
    }
  });

  it("never moves a drum more than a minor third from the pitch it was voiced at", () => {
    for (let rootMidi = 48; rootMidi < 60; rootMidi++) {
      for (const drum of PITCHED) {
        const moved = midiOf(bodyOf(kit(rootMidi)[drum]));
        const authored = midiOf(bodyOf(DRUM_KITS.default[drum]));
        expect(Math.abs(moved - authored)).toBeLessThanOrEqual(3); // keeps its character
      }
    }
  });

  it("tunes each drum to the KEY, not to the other drums", () => {
    // This kit voices its snare a semitone under its kick. Shifting the kit as one
    // ratio would preserve that, leaving the snare a flat second against every tonic.
    for (let rootMidi = 48; rootMidi < 60; rootMidi++) {
      const k = kit(rootMidi);
      expect(pc(midiOf(bodyOf(k.snare)) - midiOf(bodyOf(k.kick)))).not.toBe(1);
    }
  });

  it("leaves a hat alone — noise has no pitch to tune", () => {
    expect(kit(61).hat).toEqual(DRUM_KITS.default.hat);
  });
});
