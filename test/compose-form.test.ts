import { describe, expect, it } from "vitest";
import { buildForm } from "../src/compose/form";
import { makeRng } from "../src/rng";
import { SCALES } from "../src/theory/scales";

const base = { scale: SCALES.major, rootMidi: 60, bars: 8, beatsPerBar: 4, density: 0.5 } as const;

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

  it("uses one profile per distinct label and a recognised template", () => {
    const form = buildForm({ rng: makeRng(1), ...base });
    expect(form.sections.length).toBeGreaterThanOrEqual(4); // a real multi-section piece
    const byLabel = new Map(form.sections.map((s) => [s.label, s]));
    for (const s of form.sections) expect(s).toBe(byLabel.get(s.label)); // every "A" is the same object
    expect(form.sections[0]!.label).toBe("A"); // starts at home
  });

  it("contrasts the bridge (B) against home (A): sparser, own progression", () => {
    const form = formWithB();
    const A = form.sections.find((s) => s.label === "A")!;
    const B = form.sections.find((s) => s.label === "B")!;
    expect(B.density).toBeLessThan(A.density); // bridge is thinner
    expect(A.plan).not.toBe(B.plan); // distinct sections → distinct progressions
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
