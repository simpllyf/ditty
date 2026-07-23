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
import type { RagaPaths, Scale } from "../theory/scales";
import type { ArpRole, BassPatternName, PadPattern, TextureName, VoiceToggles } from "./arranger";
import { type HarmonicPlan, generateHarmony } from "./harmony";
import { type MelodyNote, generateMelody } from "./melody";
import { type MotifDevelopment, PLAIN_STATEMENT } from "./motif";

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
  readonly dynamicsTo?: number; // if set, the level ramps to this by the section's end (a build's crescendo)
  readonly bpmScale: number; // tempo multiplier vs the base (B pulls back, C pushes)
  readonly groove: DrumGrooveName; // drum groove (B sparser, C busier than home)
  readonly voices: VoiceToggles; // which voices play this section (instruments enter/leave)
  readonly arpRole: ArpRole; // how the arp is orchestrated (arpeggio / harmony / tutti double)
  readonly padPattern: PadPattern; // how the pad voices chords (sustain / broken / stabs)
  readonly development: MotifDevelopment; // how this part treats the theme (state it / develop it)
  readonly range: readonly [number, number]; // the lead's register for this part
  readonly part: string; // what this part is called ("B" / "anupallavi")
  readonly bars: number; // this part's own length — a charanam says more than a refrain
  readonly fill: boolean; // end this section with a drum fill (leads into a part change)
}

/** The per-label musical recipe, before the per-position `fill` is assigned. */
type SectionRecipe = Omit<SectionProfile, "fill">;

/** A whole piece: sections in play order, plus the recurring theme they share. */
export interface Form {
  readonly kind: FormKind;
  /**
   * A one-time opening, played before the cycle and never again. Endless music has no
   * end, but it can still have a beginning: without one a listener is dropped into the
   * middle of a full arrangement. Null when the caller opts out.
   */
  readonly intro: SectionProfile | null;
  readonly sections: readonly SectionProfile[];
  readonly motif: readonly MelodyNote[]; // the piece's theme, developed at each section's head
  readonly motifBars: number;
}

export interface FormOptions {
  readonly rng: Rng;
  readonly scale: Scale; // harmony parent
  readonly raga: Scale; // melody scale (for the theme)
  readonly paths?: RagaPaths; // arohana/avarohana — the theme moves the way the raga does
  readonly rootMidi: number;
  readonly bars: number; // bars per section
  readonly beatsPerBar: number;
  readonly density: number; // base melodic density (section A's level)
  readonly groove: DrumGrooveName; // home groove (section A); B/C contrast it
  readonly borrow: boolean; // allow occasional borrowed (non-diatonic) chords
  readonly secondaryDominants: boolean; // allow occasional secondary dominants
  readonly sevenths?: readonly number[]; // scale degrees voiced with their diatonic 7th
  readonly form?: FormKind; // pin the layout; otherwise the seed picks one
  readonly intro?: boolean; // open with a one-time introduction (default true)
}

/**
 * Which voices a section plays, as an arc ACROSS the piece rather than per part.
 * Recipes are built once per label, so without this every A is orchestrated
 * identically and the full ensemble simply arrives in bar one and stays.
 *
 * The opening holds back its colour voice and lets the arp enter with the second
 * section; the last section before the form comes round again drops its drums, so
 * the piece eases out and back in rather than looping at a flat blast. Lead, bass
 * and pad are the core and are never taken away here.
 *
 * A kriti is exempt: its ensemble plays throughout, and thinning it would be a
 * different tradition's idea of an arrangement.
 */
function orchestration(index: number, total: number, kind: FormKind): VoiceToggles {
  if (kind === "kriti") return {};
  if (index === 0) return { arp: false }; // the colour enters after the theme is stated
  if (index === total - 1 && total >= 4) return { drums: false }; // ease out into the wrap
  return {};
}

/**
 * The opening: a few bars of pad and bass over the home harmony, with no theme, no
 * drums and no colour. It settles the key and the tempo so the arrangement's entry
 * lands as an arrival — and holding the theme back is what makes its first statement
 * sound like one.
 */
function buildIntro(o: FormOptions, home: SectionRecipe): SectionProfile {
  const bars = Math.max(4, Math.round(o.bars / 2));
  return {
    ...home,
    part: "intro",
    label: "intro",
    bars,
    // The home progression's own opening bars, so the intro previews the harmony the
    // piece is about to state rather than announcing something it never returns to.
    plan: { ...home.plan, bars: home.plan.bars.slice(0, bars), cadences: { half: -1, final: -1 } },
    texture: "full",
    density: clampDensity(o.density * 0.5),
    // Genuinely soft, not just sparse. The opening sits well below the limiter's ceiling, so
    // pulling it down here is heard as quieter (the loud sections can't move — they're pinned),
    // which is what widens the arc and lets the climax tower.
    dynamics: 0.68,
    development: PLAIN_STATEMENT,
    voices: { lead: false, arp: false, drums: false },
    fill: false,
  };
}

/** Bars the recurring theme spans (stated at the head of every section). */
const MOTIF_BARS = 2;

/**
 * How a piece is laid out. A `song` moves through home / bridge / climax, modulating
 * and re-texturing as it goes. A `kriti` is the Carnatic form: pallavi, anupallavi,
 * charanam — the refrain returning between each, the whole piece in ONE raga and one
 * tonic, distinguished by where in the register each part sings rather than by key.
 */
export type FormKind = "song" | "kriti";

/** A layout: the parts in play order, by section label (A = home/pallavi, B, C). */
interface FormTemplate {
  readonly kind: FormKind;
  readonly parts: readonly string[];
}

const FORM_TEMPLATES: readonly FormTemplate[] = [
  { kind: "song", parts: ["A", "A", "B", "A"] }, // AABA — classic 32-bar song form
  { kind: "song", parts: ["A", "B", "A", "B"] }, // verse/chorus
  { kind: "song", parts: ["A", "B", "A", "C"] }, // verse/bridge/verse/climax
  { kind: "song", parts: ["A", "B", "A", "B", "A", "C"] }, // longer arc to a climax
  { kind: "song", parts: ["A", "A", "B", "A", "B", "A"] }, // extended AABA
  { kind: "song", parts: ["A", "B", "A", "C", "A"] }, // rondo-ish, returns home
  { kind: "song", parts: ["A", "B", "C", "A"] }, // build through bridge to climax, then home
  // The kriti cycle: pallavi · anupallavi · pallavi · charanam · pallavi.
  { kind: "kriti", parts: ["A", "B", "A", "C", "A"] },
];

/** What each part is called, so a listener hears the form named the way it's built. */
const PART_NAMES: Record<FormKind, Record<string, string>> = {
  song: { A: "A", B: "B", C: "C" },
  kriti: { A: "pallavi", B: "anupallavi", C: "charanam" },
};

/**
 * The lead's register per kriti part. A kriti sings the same raga throughout, so WHERE
 * it sings is what tells the parts apart: the pallavi holds the reference octave, the
 * anupallavi answers an octave above it — theme included, since its range admits only
 * the lifted copy — and the charanam starts where the pallavi sits and climbs.
 *
 * No part reaches below the tonic. The authentic charanam drops into the lower octave,
 * but that register belongs to the bass here, and a lead that sings under its own bass
 * muddies the arrangement and inverts the voices.
 */
function kritiRange(label: string, octave: number): readonly [number, number] {
  const span = DEFAULT_RANGE[1]; // the degrees the theme itself covers
  // An octave is `octave` DEGREES, and that differs by raga — a pentatonic's degree 14
  // is more than two octaves up, not one. Ranges have to be measured in the raga's own
  // steps or a five-note raga sends the anupallavi shrieking.
  if (label === "B") return [octave, octave + span]; // holds the theme, lifted one octave
  if (label === "C") return [0, span + Math.ceil(octave / 2)]; // starts home, climbs above it
  return [0, span];
}

/** Default lead register — the octave above the tonic. */
const DEFAULT_RANGE: readonly [number, number] = [0, 7];
/**
 * The climax sings higher. A raised register is the one intensity cue the master limiter
 * can't flatten (it caps loudness, not pitch), so lifting the tessitura is what makes the
 * peak read as a peak — home is already full and loud, so register and density are the axes
 * with headroom left. Kept short of the very top so it lifts without turning shrill.
 */
const CLIMAX_RANGE: readonly [number, number] = [4, 11];
/** A build section pulls its level back to this, then swells up into the climax. */
const BUILD_FROM = 0.85;
/** Climax level a build ramps toward when (defensively) no C recipe is on hand. */
const DEFAULT_CLIMAX_DYNAMICS = 1.12;

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

// How each part treats the theme. The bridge is where a theme gets taken apart —
// mirrored, or broken to its head and insisted on a step at a time; the climax
// intensifies it — broadened into long notes, or lifted to a higher degree. Home
// always restates it plainly: a refrain that returns as itself is what makes the
// development elsewhere legible as development.
const BRIDGE_DEVELOPMENT: readonly MotifDevelopment[] = [
  { transform: "inversion", step: 0 },
  { transform: "fragmentation", step: 1 },
  { transform: "fragmentation", step: -1 },
  { transform: "sequence", step: -2 },
];
const CLIMAX_DEVELOPMENT: readonly MotifDevelopment[] = [
  { transform: "augmentation", step: 0 },
  { transform: "sequence", step: 2 },
  { transform: "sequence", step: 1 },
];

/**
 * This section's tonic: home for A; a related key for the bridge; a lift for the climax.
 * A kriti never leaves home — the raga IS the piece, and modulating out of it would be
 * a different raga.
 */
function sectionBars(label: string, o: FormOptions, kind: FormKind): number {
  // A kriti's charanam is its long part: it carries the most text and the widest
  // melodic ground, so a charanam the length of the refrain isn't really a charanam.
  return kind === "kriti" && label === "C" ? Math.round(o.bars * 1.5) : o.bars;
}

function sectionRoot(label: string, o: FormOptions, kind: FormKind): number {
  if (kind === "kriti") return o.rootMidi;
  if (label === "B") return modulate(o.rootMidi, o.rng.pick([0, 5, 7, -5])); // bridge → a related key
  if (label === "C") return modulate(o.rootMidi, o.rng.pick([0, 2, 5])); // climax → a step/4th lift
  return o.rootMidi; // A — home key
}

// How a kriti develops its theme. The anupallavi answers the pallavi from higher up;
// the charanam broadens it.
const ANUPALLAVI_DEVELOPMENT: readonly MotifDevelopment[] = [
  { transform: "sequence", step: 2 },
  { transform: "sequence", step: 1 },
  { transform: "inversion", step: 0 },
];
const CHARANAM_DEVELOPMENT: readonly MotifDevelopment[] = [
  { transform: "augmentation", step: 0 },
  { transform: "fragmentation", step: 1 },
  { transform: "sequence", step: -1 },
];

/**
 * One part of a kriti. The parts are told apart by REGISTER and by what they do with
 * the theme, not by key or meter: the raga and the tala hold for the whole piece, so
 * there is no modulation here and no groove swap, and the ensemble never drops out
 * the way a song's bridge does.
 */
function kritiSection(
  label: string,
  o: FormOptions,
  rootMidi: number,
  plan: HarmonicPlan,
  bars: number,
): SectionRecipe {
  const shared = {
    label,
    rootMidi,
    plan,
    bars,
    bpmScale: 1, // the tala doesn't shift mid-piece
    groove: o.groove,
    voices: {}, // the ensemble plays throughout
    padPattern: "sustain" as PadPattern, // a held bed, standing in for the drone
    range: kritiRange(label, o.raga.length),
    part: PART_NAMES.kriti[label] ?? label,
  };
  if (label === "B") {
    // Anupallavi: the answer, sung an octave above the pallavi — theme and all.
    return {
      ...shared,
      texture: "build",
      bassPattern: o.rng.pick(["rootFifth", "walking"]),
      density: clampDensity(o.density * 1.1),
      contour: o.rng.pick(["rising", "arch"]),
      dynamics: 1.06,
      arpRole: o.rng.pick(["harmony", "arp"]),
      development: o.rng.pick(ANUPALLAVI_DEVELOPMENT),
    };
  }
  if (label === "C") {
    // Charanam: the final part. It opens on the theme where the pallavi states it and
    // climbs from there, so it arrives rather than simply returning.
    return {
      ...shared,
      texture: "full",
      bassPattern: "rootFifth",
      density: clampDensity(o.density),
      contour: "rising",
      dynamics: 1.04,
      arpRole: o.rng.pick(["arp", "harmony"]),
      development: o.rng.pick(CHARANAM_DEVELOPMENT),
    };
  }
  // Pallavi: the refrain, in its own register, stated plainly every time it returns.
  return {
    ...shared,
    texture: "full",
    bassPattern: o.rng.pick(["rootFifth", "sustained"]),
    density: clampDensity(o.density),
    contour: o.rng.pick(["arch", "flat"]),
    dynamics: 1,
    arpRole: "arp",
    development: PLAIN_STATEMENT,
  };
}

/** Build one section's recipe with deliberate contrast from the home section. */
function buildSection(label: string, o: FormOptions, kind: FormKind): SectionRecipe {
  const rootMidi = sectionRoot(label, o, kind); // may modulate to a new key
  const bars = sectionBars(label, o, kind);
  const plan = generateHarmony({
    rng: o.rng.fork(),
    scale: o.scale,
    rootMidi,
    bars,
    beatsPerBar: o.beatsPerBar,
    borrow: o.borrow,
    secondaryDominants: o.secondaryDominants,
    ...(o.sevenths !== undefined ? { sevenths: o.sevenths } : {}),
  });
  if (kind === "kriti") return kritiSection(label, o, rootMidi, plan, bars);
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
      dynamics: 0.72, // a real dip — softer than home so the arc has depth under the climax
      bpmScale: 0.96, // bridge eases back a touch
      groove: sparser(o.groove),
      voices: { drums: false }, // drums drop out — an intimate, drumless bridge
      arpRole: o.rng.pick(["harmony", "counter"]), // two-part bridge: parallel harmony or an antiphonal counter
      padPattern: "broken", // pad drifts through the chord — gentle bridge movement
      development: o.rng.pick(BRIDGE_DEVELOPMENT),
      range: DEFAULT_RANGE,
      part: label,
      bars,
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
      density: clampDensity(o.density * 1.4),
      contour: o.rng.pick(["rising", "arch"]),
      dynamics: 1.12,
      bpmScale: 1.06, // climax pushes ahead
      groove: busier(o.groove),
      voices: {}, // full ensemble
      arpRole: "arp", // a busy running figure — the climax DRIVES (a sparse octave-double read as calmer than home)
      padPattern: "stabs", // pad punches on each beat — drives the climax
      development: o.rng.pick(CLIMAX_DEVELOPMENT),
      range: CLIMAX_RANGE, // sing higher — the intensity cue the limiter can't cap
      part: label,
      bars,
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
    development: PLAIN_STATEMENT, // the refrain returns as itself
    range: DEFAULT_RANGE,
    part: label,
    bars,
  };
}

/**
 * Assemble a {@link Form}: pick a template, build one recipe per DISTINCT section
 * label, then lay them out in play order — flagging a `fill` on any section whose
 * NEXT section is a different part (so a drum fill announces each part change).
 */
export function buildForm(o: FormOptions): Form {
  // A pinned layout still draws from the pool, so the seed→form mapping stays stable
  // for every other kind.
  const drawn = o.rng.pick(FORM_TEMPLATES);
  const template =
    o.form === undefined ? drawn : (FORM_TEMPLATES.find((t) => t.kind === o.form) ?? drawn);
  const { kind, parts } = template;
  const recipes = new Map<string, SectionRecipe>();
  for (const label of parts) {
    if (!recipes.has(label)) recipes.set(label, buildSection(label, o, kind));
  }
  const sections = parts.map((label, i) => {
    const recipe = recipes.get(label)!;
    const section = {
      ...recipe,
      // The part's own scoring, then the arc across the piece — so a section that
      // recurs is not orchestrated identically every time it comes round.
      voices: { ...recipe.voices, ...orchestration(i, parts.length, kind) },
      fill: parts[(i + 1) % parts.length] !== label, // fill into a part change (incl. the loop wrap)
    };
    // Build INTO the climax: the section right before it pulls back and swells, its arp/drums
    // re-entering across the bars, so the peak lands as an arrival rather than a flat step up.
    if (kind !== "kriti" && parts[i + 1] === "C" && label !== "C") {
      return {
        ...section,
        texture: "build" as const,
        dynamics: BUILD_FROM,
        dynamicsTo: recipes.get("C")?.dynamics ?? DEFAULT_CLIMAX_DYNAMICS,
      };
    }
    return section;
  });

  // The theme: a short phrase over the home section's opening bars, stated at the head
  // of every section (auto-transposing with each section's key) and developed there
  // according to that part's recipe.
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
    ...(o.paths !== undefined ? { paths: o.paths } : {}),
  });
  const intro = o.intro === false ? null : buildIntro(o, home);
  return { kind, intro, sections, motif, motifBars: MOTIF_BARS };
}
