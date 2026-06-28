/**
 * Form — the piece-level structure above a single loop. A {@link Form} is an
 * ordered list of {@link SectionProfile}s (A / B / C…) that the session plays in
 * sequence and repeats as a whole, so music has real shape (verse/bridge/return)
 * instead of one bar-loop repainted forever.
 *
 * Each distinct section gets its OWN chord progression plus a contrasting texture,
 * melodic density, bass pattern, dynamics, and even key (the bridge may modulate, the
 * climax may lift) — so B genuinely sounds like a different part from A, not a tweak.
 * The instruments (the "band") stay fixed across sections; only the arrangement
 * changes. Pure brain: data in, data out, no Web Audio.
 */
import type { Rng } from "../rng";
import type { Scale } from "../theory/scales";
import type { BassPatternName, TextureName } from "./arranger";
import { type HarmonicPlan, generateHarmony } from "./harmony";
import { type MelodyNote, generateMelody } from "./melody";

/** One section's arrangement recipe: its harmony plus how it's played. */
export interface SectionProfile {
  readonly label: string; // "A" | "B" | "C" — which part this is
  readonly rootMidi: number; // this section's tonic — may modulate away from home (key change)
  readonly plan: HarmonicPlan; // this section's own chord progression
  readonly texture: TextureName; // arp/drums dynamic arc
  readonly bassPattern: BassPatternName;
  readonly density: number; // melodic density 0..1 (contrast: B sparser, C busier)
  readonly dynamics: number; // velocity scale — the loud/soft arc (B softer, C louder)
  readonly fill: boolean; // end this section with a drum fill (leads into a part change)
}

/** The per-label musical recipe, before the per-position `fill` is assigned. */
type SectionRecipe = Omit<SectionProfile, "fill">;

/** A whole piece: sections in play order, plus the recurring theme they share. */
export interface Form {
  readonly sections: readonly SectionProfile[];
  readonly motif: readonly MelodyNote[]; // the piece's theme, stated at each section's head
  readonly motifBars: number; // bars the motif spans
}

export interface FormOptions {
  readonly rng: Rng;
  readonly scale: Scale; // harmony parent
  readonly raga: Scale; // melody scale (for the theme)
  readonly rootMidi: number;
  readonly bars: number; // bars per section
  readonly beatsPerBar: number;
  readonly density: number; // base melodic density (section A's level)
}

/** Bars the recurring theme spans (stated at the head of every section). */
const MOTIF_BARS = 2;

/** Song shapes, by section label. A = home, B = contrast/bridge, C = climax. */
const FORM_TEMPLATES: readonly (readonly string[])[] = [
  ["A", "A", "B", "A"], // AABA — classic 32-bar song form
  ["A", "B", "A", "B"], // verse/chorus
  ["A", "B", "A", "C"], // verse/bridge/verse/climax
  ["A", "B", "A", "B", "A", "C"], // longer arc to a climax
];

const clampDensity = (d: number) => Math.min(0.95, Math.max(0.05, d));

/** Apply a modulation interval, but stay home if it would leave the safe tonic range. */
const modulate = (base: number, shift: number) => {
  const m = base + shift;
  return m >= 40 && m <= 78 ? m : base;
};

/** This section's tonic: home for A; a related key for the bridge; a lift for the climax. */
function sectionRoot(label: string, o: FormOptions): number {
  if (label === "B") return modulate(o.rootMidi, o.rng.pick([0, 5, 7, -5])); // bridge → a related key
  if (label === "C") return modulate(o.rootMidi, o.rng.pick([0, 2, 5])); // climax → a step/4th lift
  return o.rootMidi; // A — home key
}

/** Build one section's recipe with deliberate contrast from the home section. */
function buildSection(label: string, o: FormOptions): SectionRecipe {
  const rootMidi = sectionRoot(label, o); // may modulate to a new key
  const plan = generateHarmony({
    rng: o.rng.fork(),
    scale: o.scale,
    rootMidi,
    bars: o.bars,
    beatsPerBar: o.beatsPerBar,
  });
  if (label === "B") {
    // Bridge/breakdown: thinner, gentler, and quieter than home (often a new key).
    return {
      label,
      rootMidi,
      plan,
      texture: o.rng.pick(["breakdown", "build", "pulse"]),
      bassPattern: o.rng.pick(["sustained", "walking", "rootFifth"]),
      density: clampDensity(o.density * 0.6),
      dynamics: 0.82,
    };
  }
  if (label === "C") {
    // Climax: full, driving, busier and louder than home (often a key lift).
    return {
      label,
      rootMidi,
      plan,
      texture: "full",
      bassPattern: "pulse",
      density: clampDensity(o.density * 1.25),
      dynamics: 1.12,
    };
  }
  // A — home: full texture, steady bass, base density, reference level, home key.
  return {
    label,
    rootMidi,
    plan,
    texture: "full",
    bassPattern: o.rng.pick(["rootFifth", "rootFifth", "walking"]),
    density: clampDensity(o.density),
    dynamics: 1,
  };
}

/**
 * Assemble a {@link Form}: pick a template, build one recipe per DISTINCT section
 * label, then lay them out in play order — flagging a `fill` on any section whose
 * NEXT section is a different part (so a drum fill announces each part change).
 */
export function buildForm(o: FormOptions): Form {
  const template = o.rng.pick(FORM_TEMPLATES);
  const recipes = new Map<string, SectionRecipe>();
  for (const label of template) {
    if (!recipes.has(label)) recipes.set(label, buildSection(label, o));
  }
  const sections = template.map((label, i) => ({
    ...recipes.get(label)!,
    fill: template[(i + 1) % template.length] !== label, // fill into a part change (incl. the loop wrap)
  }));

  // The theme: a short phrase over the home section's opening bars, stated verbatim
  // at the head of every section (auto-transposing with each section's key).
  const home = recipes.get("A")!;
  const motif = generateMelody({
    rng: o.rng.fork(),
    plan: {
      ...home.plan,
      bars: home.plan.bars.slice(0, MOTIF_BARS),
      cadences: { half: -1, final: -1 },
    },
    scale: o.raga,
    density: o.density,
  });
  return { sections, motif, motifBars: MOTIF_BARS };
}
