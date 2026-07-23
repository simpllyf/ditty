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
  groove: "straight",
  borrow: false,
  secondaryDominants: false,
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

  it("the climax (C) rises above home: higher register and busier", () => {
    let form = buildForm({ rng: makeRng(1), ...base });
    for (let s = 2; s < 80 && !form.sections.some((x) => x.label === "C"); s++) {
      form = buildForm({ rng: makeRng(s), ...base });
    }
    const A = form.sections.find((s) => s.label === "A")!;
    const C = form.sections.find((s) => s.label === "C")!;
    // Register is the intensity cue the master limiter can't flatten — the climax must sing
    // higher than home, not merely fuller. (Its lead-degree window starts above home's.)
    expect(C.range[0]).toBeGreaterThan(A.range[0]);
    expect(C.range[1]).toBeGreaterThan(A.range[1]);
    expect(C.density).toBeGreaterThan(A.density); // …and busier
    expect(C.dynamics).toBeGreaterThan(A.dynamics); // …and pushes louder
  });

  it("builds INTO the climax: the section before it pulls back and swells", () => {
    let form = buildForm({ rng: makeRng(1), ...base });
    for (let s = 2; s < 80 && !form.sections.some((x) => x.label === "C"); s++) {
      form = buildForm({ rng: makeRng(s), ...base });
    }
    const ci = form.sections.findIndex((x) => x.label === "C");
    const approach = form.sections[ci - 1]!;
    // A crescendo built into the bars — pulled back, ramping up to the climax's level.
    expect(approach.dynamicsTo).toBeGreaterThan(approach.dynamics);
    expect(approach.dynamicsTo).toBe(form.sections[ci]!.dynamics);
    expect(approach.texture).toBe("build"); // arp/drums re-enter across the bars
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

  it("varies tempo per section: home steady, bridge eases back, climax pushes", () => {
    const form = formWithB();
    for (const a of form.sections.filter((s) => s.label === "A")) expect(a.bpmScale).toBe(1);
    for (const b of form.sections.filter((s) => s.label === "B"))
      expect(b.bpmScale).toBeLessThan(1);
    for (const c of form.sections.filter((s) => s.label === "C"))
      expect(c.bpmScale).toBeGreaterThan(1);
  });

  it("orchestrates the arp per section: A arpeggiates, B is two-part, C doubles", () => {
    const allowed = (label: string) =>
      label === "A" ? ["arp"] : label === "B" ? ["harmony", "counter"] : ["double"];
    for (let s = 1; s < 30; s++) {
      for (const sec of buildForm({ rng: makeRng(s), ...base, form: "song" }).sections) {
        expect(allowed(sec.label)).toContain(sec.arpRole);
      }
    }
  });

  it("drops drums in every bridge, and never thins the core", () => {
    const form = formWithB();
    for (const b of form.sections.filter((s) => s.label === "B")) {
      expect(b.voices.drums).toBe(false); // an intimate, drumless bridge
    }
    // A and C are scored by the arc across the piece rather than by their label, so
    // what they carry depends on WHERE they fall — but never on the core voices.
    for (const s of form.sections) {
      for (const core of ["lead", "bass", "pad"] as const) expect(s.voices[core]).not.toBe(false);
    }
    // …and somewhere in the piece the whole ensemble does play.
    expect(form.sections.some((s) => Object.keys(s.voices).length === 0)).toBe(true);
  });

  it("varies the groove per section: home (A), sparser bridge (B), busier climax (C)", () => {
    const form = formWithB();
    for (const a of form.sections.filter((s) => s.label === "A")) expect(a.groove).toBe("straight");
    for (const b of form.sections.filter((s) => s.label === "B")) expect(b.groove).toBe("halfTime");
    for (const c of form.sections.filter((s) => s.label === "C")) expect(c.groove).toBe("busy");
  });

  it("orchestrates the pad per section: A sustains, B broken, C stabs", () => {
    for (let s = 1; s < 30; s++) {
      const form = buildForm({ rng: makeRng(s), ...base, form: "song" });
      for (const sec of form.sections) {
        const expected = sec.label === "A" ? "sustain" : sec.label === "B" ? "broken" : "stabs";
        expect(sec.padPattern).toBe(expected);
      }
    }
  });

  it("shapes a melodic contour per section: C builds, B settles, and they vary", () => {
    const allowed = (label: string) =>
      label === "C"
        ? ["rising", "arch"] // climax builds
        : label === "B"
          ? ["falling", "flat", "arch"] // bridge settles
          : ["arch", "rising", "flat"]; // home varies
    const seen = new Set<string>();
    for (let s = 1; s < 40; s++) {
      for (const sec of buildForm({ rng: makeRng(s), ...base, form: "song" }).sections) {
        seen.add(sec.contour);
        expect(allowed(sec.label)).toContain(sec.contour);
      }
    }
    expect(seen.size).toBeGreaterThan(1); // the contour genuinely varies across the corpus
  });

  it("orchestrates the bridge as a two-part texture — parallel harmony or an antiphonal counter", () => {
    const bridgeRoles = new Set<string>();
    for (let s = 1; s < 40; s++) {
      for (const sec of buildForm({ rng: makeRng(s), ...base, form: "song" }).sections) {
        if (sec.label === "B") bridgeRoles.add(sec.arpRole);
      }
    }
    expect([...bridgeRoles].sort()).toEqual(["counter", "harmony"]); // both appear, nothing else
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

  it("develops the theme per part: home states it, the bridge and climax transform it", () => {
    const byLabel = new Map<string, Set<string>>();
    for (let s = 1; s < 40; s++) {
      for (const sec of buildForm({ rng: makeRng(s), ...base }).sections) {
        const seen = byLabel.get(sec.label) ?? new Set<string>();
        seen.add(sec.development.transform);
        byLabel.set(sec.label, seen);
      }
    }
    // The refrain always returns as itself — that is what makes it a refrain, and
    // what lets the ear hear the other parts AS developments of it.
    expect([...byLabel.get("A")!]).toEqual(["statement"]);
    for (const label of ["B", "C"]) {
      const transforms = byLabel.get(label)!;
      expect(transforms.size).toBeGreaterThan(1); // more than one device in play
      expect(transforms.has("statement")).toBe(false); // ...and never a plain repeat
    }
  });

  it("lays a kriti out as pallavi · anupallavi · pallavi · charanam · pallavi", () => {
    const form = buildForm({ rng: makeRng(1), ...base, form: "kriti" });
    expect(form.kind).toBe("kriti");
    expect(form.sections.map((s) => s.part)).toEqual([
      "pallavi",
      "anupallavi",
      "pallavi",
      "charanam",
      "pallavi",
    ]);
    // The refrain is the anchor: it returns between the other parts, always as itself.
    for (const s of form.sections.filter((x) => x.part === "pallavi")) {
      expect(s.development).toEqual({ transform: "statement", step: 0 });
    }
  });

  it("keeps a kriti in one raga: no modulation, no groove change, nobody drops out", () => {
    for (let s = 1; s < 30; s++) {
      const form = buildForm({ rng: makeRng(s), ...base, form: "kriti" });
      for (const sec of form.sections) {
        // The raga IS the piece — a key change would make it a different raga.
        expect(sec.rootMidi).toBe(base.rootMidi);
        expect(sec.groove).toBe(base.groove); // the tala holds throughout
        expect(sec.bpmScale).toBe(1);
        expect(sec.voices).toEqual({}); // no drumless bridge — the ensemble plays on
      }
    }
  });

  it("tells a kriti's parts apart by register, and never sings below the tonic", () => {
    const octave = base.raga.length;
    for (let s = 1; s < 30; s++) {
      const byPart = new Map<string, readonly [number, number]>();
      for (const sec of buildForm({ rng: makeRng(s), ...base, form: "kriti" }).sections) {
        byPart.set(sec.part, sec.range);
      }
      const centre = (r: readonly [number, number]) => (r[0] + r[1]) / 2;
      const pallavi = centre(byPart.get("pallavi")!);
      const anupallavi = centre(byPart.get("anupallavi")!);
      expect(anupallavi).toBeGreaterThan(pallavi); // answers from above…
      expect(centre(byPart.get("charanam")!)).toBeGreaterThan(pallavi); // …and the charanam climbs
      expect(anupallavi).toBeGreaterThan(centre(byPart.get("charanam")!)); // three distinct levels
      for (const range of byPart.values()) {
        // The lower octave belongs to the bass; a lead singing under it inverts the voices.
        expect(range[0]).toBeGreaterThanOrEqual(0);
      }
      // The anupallavi holds the theme lifted a whole octave, so stating it never clamps.
      const [lo, hi] = byPart.get("anupallavi")!;
      expect(lo).toBe(octave);
      expect(hi).toBeGreaterThanOrEqual(octave + 7);
    }
  });

  it("a song form keeps one register and may modulate — the kriti rules are its own", () => {
    const song = buildForm({ rng: makeRng(3), ...base, form: "song" });
    expect(song.kind).toBe("song");
    for (const sec of song.sections) expect(sec.range).toEqual([0, 7]);
    expect(song.sections.map((s) => s.part)).toEqual(song.sections.map((s) => s.label));
  });

  it("gives a kriti's charanam its own length — the long part of the piece", () => {
    for (const bars of [4, 8, 12]) {
      const form = buildForm({ rng: makeRng(2), ...base, bars, form: "kriti" });
      const lengthOf = (part: string) => form.sections.find((s) => s.part === part)!.bars;
      expect(lengthOf("pallavi")).toBe(bars); // the refrain sets the measure
      expect(lengthOf("anupallavi")).toBe(bars);
      expect(lengthOf("charanam")).toBeGreaterThan(bars);
      // Its harmony has to be planned at its own length, not the base one.
      const charanam = form.sections.find((s) => s.part === "charanam")!;
      expect(charanam.plan.bars.length).toBe(charanam.bars);
      // A section is never shorter than a progression can be written for.
      for (const s of form.sections) expect(s.bars).toBeGreaterThanOrEqual(4);
    }
  });

  it("orchestrates an arc across the piece, not the same ensemble every section", () => {
    // Recipes are built once per label, so without a per-POSITION arc every A is scored
    // identically and the full ensemble simply arrives in bar one and stays.
    for (let s = 1; s < 30; s++) {
      const form = buildForm({ rng: makeRng(s), ...base, form: "song" });
      const scorings = form.sections.map((sec) => JSON.stringify(sec.voices));
      expect(new Set(scorings).size).toBeGreaterThan(1); // the ensemble actually changes

      expect(form.sections[0]!.voices.arp).toBe(false); // colour enters after the theme
      const last = form.sections[form.sections.length - 1]!;
      // The section before the wrap eases out, so the form doesn't loop at a flat blast.
      expect(last.voices.drums).toBe(form.sections.length >= 4 ? false : last.voices.drums);
      // Lead, bass and pad are the core — an arc thins the colour, never the foundation.
      for (const sec of form.sections) {
        for (const core of ["lead", "bass", "pad"] as const) {
          expect(sec.voices[core]).not.toBe(false);
        }
      }
    }
  });

  it("leaves a kriti's ensemble playing throughout", () => {
    // A kriti's accompaniment does not thin out; that is a different tradition's idea
    // of an arrangement.
    for (let s = 1; s < 20; s++) {
      for (const sec of buildForm({ rng: makeRng(s), ...base, form: "kriti" }).sections) {
        expect(sec.voices).toEqual({});
      }
    }
  });

  it("keeps every song section at the base length", () => {
    const form = buildForm({ rng: makeRng(2), ...base, bars: 8, form: "song" });
    for (const s of form.sections) expect(s.bars).toBe(8);
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
