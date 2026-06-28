import { describe, expect, it } from "vitest";
import {
  DRUM_KITS,
  INSTRUMENTS,
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
