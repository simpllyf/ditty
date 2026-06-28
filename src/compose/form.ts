/**
 * Form — the piece-level structure above a single loop. A {@link Form} is an
 * ordered list of {@link SectionProfile}s (A / B / C…) that the session plays in
 * sequence and repeats as a whole, so music has real shape (verse/bridge/return)
 * instead of one bar-loop repainted forever.
 *
 * Each distinct section gets its OWN chord progression plus a contrasting texture,
 * melodic density, and bass pattern — so B genuinely sounds like a different part
 * from A, not a tweak. The instruments (the "band") stay fixed across sections;
 * only the arrangement changes. Pure brain: data in, data out, no Web Audio.
 */
import type { Rng } from "../rng";
import type { Scale } from "../theory/scales";
import type { BassPatternName, TextureName } from "./arranger";
import { type HarmonicPlan, generateHarmony } from "./harmony";

/** One section's arrangement recipe: its harmony plus how it's played. */
export interface SectionProfile {
  readonly label: string; // "A" | "B" | "C" — which part this is
  readonly plan: HarmonicPlan; // this section's own chord progression
  readonly texture: TextureName; // arp/drums dynamic arc
  readonly bassPattern: BassPatternName;
  readonly density: number; // melodic density 0..1 (contrast: B sparser, C busier)
}

/** A whole piece: sections in play order; the session loops the entire list. */
export interface Form {
  readonly sections: readonly SectionProfile[];
}

export interface FormOptions {
  readonly rng: Rng;
  readonly scale: Scale; // harmony parent
  readonly rootMidi: number;
  readonly bars: number; // bars per section
  readonly beatsPerBar: number;
  readonly density: number; // base melodic density (section A's level)
}

/** Song shapes, by section label. A = home, B = contrast/bridge, C = climax. */
const FORM_TEMPLATES: readonly (readonly string[])[] = [
  ["A", "A", "B", "A"], // AABA — classic 32-bar song form
  ["A", "B", "A", "B"], // verse/chorus
  ["A", "B", "A", "C"], // verse/bridge/verse/climax
  ["A", "B", "A", "B", "A", "C"], // longer arc to a climax
];

const clampDensity = (d: number) => Math.min(0.95, Math.max(0.05, d));

/** Build one section's profile with deliberate contrast from the home section. */
function buildSection(label: string, o: FormOptions): SectionProfile {
  const plan = generateHarmony({
    rng: o.rng.fork(),
    scale: o.scale,
    rootMidi: o.rootMidi,
    bars: o.bars,
    beatsPerBar: o.beatsPerBar,
  });
  if (label === "B") {
    // Bridge/breakdown: thinner and gentler than home.
    return {
      label,
      plan,
      texture: o.rng.pick(["breakdown", "build", "pulse"]),
      bassPattern: o.rng.pick(["sustained", "walking", "rootFifth"]),
      density: clampDensity(o.density * 0.6),
    };
  }
  if (label === "C") {
    // Climax: full and driving, busier than home.
    return {
      label,
      plan,
      texture: "full",
      bassPattern: "pulse",
      density: clampDensity(o.density * 1.25),
    };
  }
  // A — home: full texture, steady bass, base density.
  return {
    label,
    plan,
    texture: "full",
    bassPattern: o.rng.pick(["rootFifth", "rootFifth", "walking"]),
    density: clampDensity(o.density),
  };
}

/**
 * Assemble a {@link Form}: pick a template, build one profile per DISTINCT section
 * label (so every "A" is the same part), then lay them out in play order.
 */
export function buildForm(o: FormOptions): Form {
  const template = o.rng.pick(FORM_TEMPLATES);
  const profiles = new Map<string, SectionProfile>();
  for (const label of template) {
    if (!profiles.has(label)) profiles.set(label, buildSection(label, o));
  }
  return { sections: template.map((label) => profiles.get(label)!) };
}
