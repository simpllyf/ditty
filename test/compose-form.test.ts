import { describe, expect, it } from "vitest";
import { buildForm } from "../src/compose/form";
import { makeRng } from "../src/rng";
import { SCALES } from "../src/theory/scales";

const base = {
  scale: SCALES.major,
  raga: SCALES.mohanam,
  rootMidi: 60,
  bars: 8,
  beatsPerBar: 4,
  density: 0.5,
} as const;

/** First seed whose form contains a B section (a contrasting part). */
function formWithB() {
  for (let s = 1; s < 50; s++) {
    const form = buildForm({ rng: makeRng(s), ...base });
    if (form.sections.some((x) => x.label === "B")) return form;
  }
  throw new Error("no B-bearing form found");
}

describe("buildForm", () => {
  it("is deterministic for a seed", () => {
    const a = buildForm({ rng: makeRng(1), ...base });
    const b = buildForm({ rng: makeRng(1), ...base });
    expect(a.sections.map((s) => s.label)).toEqual(b.sections.map((s) => s.label));
    expect(a.sections.map((s) => s.density)).toEqual(b.sections.map((s) => s.density));
  });

  it("uses one recipe per distinct label and a recognised template", () => {
    const form = buildForm({ rng: makeRng(1), ...base });
    expect(form.sections.length).toBeGreaterThanOrEqual(4); // a real multi-section piece
    const planByLabel = new Map(form.sections.map((s) => [s.label, s.plan]));
    for (const s of form.sections) expect(s.plan).toBe(planByLabel.get(s.label)); // same label → same progression
    expect(form.sections[0]!.label).toBe("A"); // starts at home
  });

  it("contrasts the bridge (B) against home (A): sparser, quieter, own progression", () => {
    const form = formWithB();
    const A = form.sections.find((s) => s.label === "A")!;
    const B = form.sections.find((s) => s.label === "B")!;
    expect(B.density).toBeLessThan(A.density); // bridge is thinner
    expect(B.dynamics).toBeLessThan(A.dynamics); // …and quieter (the dynamics arc)
    expect(A.plan).not.toBe(B.plan); // distinct sections → distinct progressions
  });

  it("modulates some sections to a related key while A stays home", () => {
    let form = buildForm({ rng: makeRng(1), ...base });
    for (let s = 2; s < 100 && form.sections.every((x) => x.rootMidi === base.rootMidi); s++) {
      form = buildForm({ rng: makeRng(s), ...base }); // find a form that actually modulates
    }
    for (const s of form.sections.filter((x) => x.label === "A")) {
      expect(s.rootMidi).toBe(base.rootMidi); // home key
    }
    expect(form.sections.some((x) => x.rootMidi !== base.rootMidi)).toBe(true); // a key change happens
    for (const s of form.sections) {
      expect(s.rootMidi).toBeGreaterThanOrEqual(40); // stays in the safe tonic range
      expect(s.rootMidi).toBeLessThanOrEqual(78);
    }
  });

  it("flags a fill exactly on sections that lead into a different part", () => {
    const form = formWithB();
    form.sections.forEach((s, i) => {
      const next = form.sections[(i + 1) % form.sections.length]!;
      expect(s.fill).toBe(next.label !== s.label);
    });
    expect(form.sections.some((s) => s.fill)).toBe(true); // a multi-part form always has ≥1 change
  });

  it("carries a recurring theme stated within its motif span", () => {
    const form = buildForm({ rng: makeRng(1), ...base });
    expect(form.motif.length).toBeGreaterThan(0); // a real theme
    expect(form.motifBars).toBeGreaterThanOrEqual(1);
    const span = form.motifBars * base.beatsPerBar;
    for (const n of form.motif) {
      expect(n.startBeat).toBeGreaterThanOrEqual(0);
      expect(n.startBeat).toBeLessThan(span); // confined to the head
    }
  });

  it("keeps section density strictly within (0,1) even at extreme base density", () => {
    for (const density of [0, 1]) {
      const form = buildForm({ rng: makeRng(3), ...base, density });
      for (const s of form.sections) {
        expect(s.density).toBeGreaterThan(0);
        expect(s.density).toBeLessThan(1);
      }
    }
  });
});
