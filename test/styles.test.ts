import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ScoreVoice } from "../src/compose/arranger";
import { instrumentsForVoice } from "../src/instruments";
import { makeRng } from "../src/rng";
import { STYLES, type StyleName, pickStyle } from "../src/styles";

const VOICES: ScoreVoice[] = ["lead", "bass", "pad", "arp"];
const STYLE_NAMES = Object.keys(STYLES) as StyleName[];
const pcs = (scale: readonly number[]) => new Set(scale.map((s) => ((s % 12) + 12) % 12));

describe("STYLES registry well-formedness", () => {
  it.each(STYLE_NAMES)("%s pairs every raga in-key (raga ⊆ parent)", (name) => {
    const style = STYLES[name];
    expect(style.keys.length).toBeGreaterThan(0);
    for (const { parent, raga } of style.keys) {
      const parentPcs = pcs(parent);
      for (const pc of pcs(raga)) expect(parentPcs.has(pc)).toBe(true);
    }
  });

  it.each(STYLE_NAMES)("%s has valid ranges and instrument pools", (name) => {
    const s = STYLES[name];
    for (const range of [s.bpm, s.swing, s.density, s.rootMidi]) {
      expect(range[0]).toBeLessThanOrEqual(range[1]);
    }
    expect(s.rootMidi[0]).toBeGreaterThanOrEqual(36); // arranger's MIN_ROOT_MIDI
    expect(s.rootMidi[1]).toBeLessThanOrEqual(84); // arranger's MAX_ROOT_MIDI
    expect(s.grooves.length).toBeGreaterThan(0);
    for (const voice of VOICES) {
      const pool = s.instruments?.[voice];
      if (!pool) continue;
      expect(pool.length).toBeGreaterThan(0);
      for (const n of pool) expect(instrumentsForVoice(voice)).toContain(n);
    }
  });
});

describe("pickStyle", () => {
  it("is deterministic per seed+name and defaults to peppy", () => {
    expect(pickStyle(makeRng(1), "calm")).toEqual(pickStyle(makeRng(1), "calm"));
    expect(pickStyle(makeRng(1))).toEqual(pickStyle(makeRng(1), "peppy"));
  });

  it("throws on an unknown style name", () => {
    // @ts-expect-error invalid style name
    expect(() => pickStyle(makeRng(1), "nope")).toThrow(RangeError);
  });

  it("locks the seed→choice mapping (golden — guards rng draw order)", () => {
    const round = (x: number) => Math.round(x * 1000) / 1000;
    const compact = STYLE_NAMES.map((name) => {
      const c = pickStyle(makeRng(42), name);
      return {
        name,
        parent: c.parent,
        raga: c.raga,
        rootMidi: c.rootMidi,
        groove: c.groove,
        bpm: c.bpm,
        swing: round(c.swing),
        density: round(c.density),
        instruments: c.instruments,
      };
    });
    expect(compact).toMatchSnapshot();
  });

  it("chooses within the style's pools and ranges (any seed)", () => {
    fc.assert(
      fc.property(fc.integer(), fc.constantFrom(...STYLE_NAMES), (seed, name) => {
        const c = pickStyle(makeRng(seed), name);
        const s = STYLES[name];
        expect(s.keys.some((k) => k.parent === c.parent && k.raga === c.raga)).toBe(true);
        expect(s.grooves).toContain(c.groove);
        expect(Number.isInteger(c.bpm)).toBe(true);
        expect(c.bpm).toBeGreaterThanOrEqual(s.bpm[0]);
        expect(c.bpm).toBeLessThanOrEqual(s.bpm[1]);
        expect(Number.isInteger(c.rootMidi)).toBe(true);
        expect(c.rootMidi).toBeGreaterThanOrEqual(s.rootMidi[0]);
        expect(c.rootMidi).toBeLessThanOrEqual(s.rootMidi[1]);
        expect(c.swing).toBeGreaterThanOrEqual(s.swing[0]);
        expect(c.swing).toBeLessThanOrEqual(s.swing[1]);
        expect(c.density).toBeGreaterThanOrEqual(s.density[0]);
        expect(c.density).toBeLessThanOrEqual(s.density[1]);
        for (const voice of VOICES) {
          expect(c.instruments[voice].length).toBeGreaterThan(0);
          for (const n of c.instruments[voice]) expect(instrumentsForVoice(voice)).toContain(n);
        }
      }),
      { numRuns: 200 },
    );
  });
});
