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
import type { ContourShape } from "../constraints";
import type { Rng } from "../rng";
import { DRUM_GROOVES, type DrumGrooveName } from "../theory/rhythm";
import type { Scale } from "../theory/scales";
import type { ArpRole, BassPatternName, PadPattern, TextureName, VoiceToggles } from "./arranger";
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
  readonly contour: ContourShape; // melodic phrase arc — A varies, B settles, C builds
  readonly dynamics: number; // velocity scale — the loud/soft arc (B softer, C louder)
  readonly bpmScale: number; // tempo multiplier vs the base (B pulls back, C pushes)
  readonly groove: DrumGrooveName; // drum groove (B sparser, C busier than home)
  readonly voices: VoiceToggles; // which voices play this section (instruments enter/leave)
  readonly arpRole: ArpRole; // how the arp is orchestrated (arpeggio / harmony / tutti double)
  readonly padPattern: PadPattern; // how the pad voices chords (sustain / broken / stabs)
  readonly fill: boolean; // end this section with a drum fill (leads into a part change)
}

/** The per-label musical recipe, before the per-position `fill` is assigned. */
type SectionRecipe = Omit<SectionProfile, "fill">;

/** A whole piece: sections in play order, plus the recurring theme they share. */
export interface Form {
  readonly sections: readonly SectionProfile[];
  readonly motif: readonly MelodyNote[]; // the piece's theme, stated at each section's head
  readonly motifBars: number;
}

export interface FormOptions {
  readonly rng: Rng;
  readonly scale: Scale; // harmony parent
  readonly raga: Scale; // melody scale (for the theme)
  readonly rootMidi: number;
  readonly bars: number; // bars per section
  readonly beatsPerBar: number;
  readonly density: number; // base melodic density (section A's level)
  readonly groove: DrumGrooveName; // home groove (section A); B/C contrast it
  readonly borrow: boolean; // allow occasional borrowed (non-diatonic) chords
}

/** Bars the recurring theme spans (stated at the head of every section). */
const MOTIF_BARS = 2;

/** Song shapes, by section label. A = home, B = contrast/bridge, C = climax. */
const FORM_TEMPLATES: readonly (readonly string[])[] = [
  ["A", "A", "B", "A"], // AABA — classic 32-bar song form
  ["A", "B", "A", "B"], // verse/chorus
  ["A", "B", "A", "C"], // verse/bridge/verse/climax
  ["A", "B", "A", "B", "A", "C"], // longer arc to a climax
  ["A", "A", "B", "A", "B", "A"], // extended AABA
  ["A", "B", "A", "C", "A"], // rondo-ish, returns home
  ["A", "B", "C", "A"], // build through bridge to climax, then home
];

const clampDensity = (d: number) => Math.min(0.95, Math.max(0.05, d));

/** Apply a modulation interval, but stay home if it would leave the safe tonic range. */
const modulate = (base: number, shift: number) => {
  const m = base + shift;
  return m >= 40 && m <= 78 ? m : base;
};

// A calmer / busier groove than the home one, for the bridge / climax contrast.
// Only the 4/4 grooves have sparse/busy counterparts; a non-4/4 groove (waltz, 6/8)
// keeps its meter and lets density/dynamics/tempo carry the section contrast instead.
const sparser = (g: DrumGrooveName): DrumGrooveName =>
  DRUM_GROOVES[g].beatsPerBar !== 4
    ? g
    : g === "halfTime" || g === "soft" || g === "none"
      ? "soft"
      : "halfTime";
const busier = (g: DrumGrooveName): DrumGrooveName =>
  DRUM_GROOVES[g].beatsPerBar !== 4
    ? g
    : g === "busy" || g === "halfDouble"
      ? "fourOnFloor"
      : "busy";

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
    borrow: o.borrow,
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
      contour: o.rng.pick(["falling", "flat", "arch"]),
      dynamics: 0.82,
      bpmScale: 0.96, // bridge eases back a touch
      groove: sparser(o.groove),
      voices: { drums: false }, // drums drop out — an intimate, drumless bridge
      arpRole: o.rng.pick(["harmony", "counter"]), // two-part bridge: parallel harmony or an antiphonal counter
      padPattern: "broken", // pad drifts through the chord — gentle bridge movement
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
      contour: o.rng.pick(["rising", "arch"]),
      dynamics: 1.12,
      bpmScale: 1.06, // climax pushes ahead
      groove: busier(o.groove),
      voices: {}, // full ensemble
      arpRole: "double", // the arp doubles the theme an octave up — a tutti climax
      padPattern: "stabs", // pad punches on each beat — drives the climax
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
    contour: o.rng.pick(["arch", "arch", "rising", "flat"]),
    dynamics: 1,
    bpmScale: 1, // home tempo
    groove: o.groove, // home groove (the style's pick)
    voices: {}, // full ensemble
    arpRole: "arp", // the arp keeps the running figure — the bed
    padPattern: "sustain", // pad holds the chord — the steady bed
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
