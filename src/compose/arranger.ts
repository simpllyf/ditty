/**
 * Arranger — composes the pure brain into a multi-part {@link Score}: lead +
 * bass + pad + arp + drums, each from its own forked rng so voices are
 * independent yet deterministic. The Score is play-ready, audio-free data (Hz +
 * beats); the engine/renderer turns it into sound.
 *
 * Requires `raga ⊆ parent` (true for the built-in style pairs, e.g. mohanam ⊂
 * major) so the lead's raga tones stay in key with the chord-tone pad/arp/bass;
 * throws otherwise.
 */
import type { ContourShape } from "../constraints";
import type { Rng } from "../rng";
import { DEFAULT_ROOT_MIDI, OCTAVE, midiToFrequency, pitchClass } from "../theory/pitch";
import { DRUM_GROOVES, type DrumGrooveName, applySwing, fitGroove } from "../theory/rhythm";
import {
  SCALES,
  type RagaPaths,
  type Scale,
  degreeToFrequency,
  degreeToSemitone,
} from "../theory/scales";
import type { DrumName, ScoreVoice } from "../voices";
import { type HarmonicPlan, generateHarmony } from "./harmony";
import { DEFAULT_MAX_LEAP, type MelodyNote, generateMelody } from "./melody";
import { type MotifDevelopment, PLAIN_STATEMENT, developMotif } from "./motif";

export type { DrumName, ScoreVoice } from "../voices";

/** Per-part on/off toggles (`drums` alongside the pitched voices). Each defaults to on. */
export type VoiceToggles = Partial<Record<ScoreVoice | "drums", boolean>>;

export interface ScoreNote {
  readonly startBeat: number;
  readonly durationBeats: number;
  readonly freq: number;
  readonly velocity: number;
}
export interface DrumHit {
  readonly startBeat: number;
  readonly drum: DrumName;
  readonly velocity: number;
}
export interface ScorePart {
  readonly voice: ScoreVoice;
  readonly notes: readonly ScoreNote[];
}

/** A complete, play-ready arrangement. Times are absolute beats; pitches are Hz. */
export interface Score {
  readonly bpm: number;
  readonly beatsPerBar: number;
  readonly bars: number;
  readonly lengthBeats: number;
  readonly rootMidi: number;
  readonly parts: readonly ScorePart[];
  readonly drums: readonly DrumHit[];
}

export interface ArrangeOptions {
  rng: Rng;
  bpm?: number;
  beatsPerBar?: number;
  bars?: number;
  /** Harmony parent scale (heptatonic). Default major. */
  parent?: Scale;
  /** Lead/arp raga. Default = parent. Must be a pitch-class subset of `parent` (raga ⊆ parent). */
  raga?: Scale;
  /** Arohana/avarohana for the raga — the lead may move differently up and down. */
  paths?: RagaPaths;
  rootMidi?: number;
  progression?: readonly number[];
  generateProgression?: boolean;
  /** Reuse a pre-built harmony plan instead of generating one — lets a caller keep the
   * chord progression fixed across loops while the melody/voicing varies (gentle evolve). */
  plan?: HarmonicPlan;
  /** Dynamic arc: which sections the arp/drums play. Default "full" (no gating). */
  texture?: TextureName;
  /** Bass rhythm/shape. Default "rootFifth". */
  bassPattern?: BassPatternName;
  /** Velocity scale for the whole section — the loud/soft arc. Default 1. */
  dynamics?: number;
  /** End the last bar with a drum fill (a buildup into the next section). Default false. */
  fill?: boolean;
  /** Recurring theme stated at the lead's head (degrees transpose with the key). */
  motif?: readonly MelodyNote[];
  /** Bars the {@link motif} spans. Default 0. */
  motifBars?: number;
  /** How this section develops the theme. Default: state it plainly. */
  development?: MotifDevelopment;
  /** The arp instrument's role: arpeggio / double the theme / harmonise it. Default "arp". */
  arpRole?: ArpRole;
  /** How the pad voices chords: held block / staggered / rhythmic stabs. Default "sustain". */
  padPattern?: PadPattern;
  groove?: DrumGrooveName;
  /** Per-voice toggles; each defaults to on. */
  voices?: VoiceToggles;
  density?: number;
  swing?: number;
  leadRange?: readonly [number, number];
  /** Melody phrase contour shape. Default "arch". */
  contour?: ContourShape;
}

const MIN_ROOT_MIDI = 36;
const MAX_ROOT_MIDI = 84;
const ARP_PATTERNS = ["up", "down", "updown"] as const;

const TEXTURE_SECTIONS = 4;
/**
 * Per-section on/off for the arp & drums, carving a dynamic arc across the loop
 * (sparse intro → build, a mid-loop breakdown, …). Lead/pad/bass stay continuous
 * so the melody and harmonic bed never drop out. `full` = no gating (the default).
 */
const TEXTURES = {
  full: { arp: [1, 1, 1, 1], drums: [1, 1, 1, 1] },
  build: { arp: [0, 0, 1, 1], drums: [0, 1, 1, 1] },
  breakdown: { arp: [1, 1, 0, 1], drums: [1, 1, 0, 1] },
  pulse: { arp: [0, 1, 0, 1], drums: [1, 1, 1, 1] },
} as const satisfies Record<string, { arp: readonly number[]; drums: readonly number[] }>;
export type TextureName = keyof typeof TEXTURES;

/** Bass rhythm/shape — varies the low-end groove so tracks don't all share one feel. */
export const BASS_PATTERNS = ["rootFifth", "walking", "pulse", "sustained"] as const;
export type BassPatternName = (typeof BASS_PATTERNS)[number];

/** What the arp instrument plays — its own arpeggio, or an orchestrated role on the theme. */
export type ArpRole = "arp" | "double" | "harmony" | "counter";

/** How the pad voices a chord — held block, broken (staggered), or rhythmic stabs. */
export type PadPattern = "sustain" | "stabs" | "broken";

/**
 * Degree of a harmony note a third below `degree`, by actual interval. A fixed -2
 * scale-degree shift is a third only in heptatonic scales; pentatonic ragas have
 * gaps, so it lands on an unintended fourth — or, if naively snapped, a clashing
 * second. Pick the scale tone whose interval below the lead is nearest a third,
 * never closer than a third (so it falls back to a fourth, not a second).
 */
export function thirdBelow(scale: Scale, degree: number): number {
  const lead = degreeToSemitone(scale, degree);
  let best = degree - 2; // a third in heptatonic; a sensible default elsewhere
  let bestDiff = Infinity;
  for (let d = degree - 1; d >= degree - 4; d--) {
    const interval = lead - degreeToSemitone(scale, d); // semitones below the lead
    if (interval < 3) continue; // never a unison/second — too close, it clashes
    const diff = Math.abs(interval - 3.5); // prefer a minor/major third
    if (diff < bestDiff) {
      bestDiff = diff;
      best = d;
    }
  }
  return best;
}

/** Cycle order of a chord's pitch classes for an arpeggio. */
function arpSequence(pcs: readonly number[], pattern: (typeof ARP_PATTERNS)[number]): number[] {
  const asc = [...pcs].sort((a, b) => a - b);
  if (pattern === "up") return asc;
  if (pattern === "down") return asc.slice().reverse();
  return [...asc, ...asc.slice(1, -1).reverse()]; // updown, endpoints not repeated
}

/**
 * Validate the resolved musical params shared by {@link arrange} and the session.
 * Calling this at session construction makes a bad config fail synchronously
 * (`createEngine` throws) rather than at the first scheduled note. Throws `RangeError`.
 */
export function assertMusicalParams(p: {
  swing: number;
  density: number;
  rootMidi: number;
  groove: string;
  parent: Scale;
  raga: Scale;
}): void {
  if (!(p.swing >= 0 && p.swing <= 1)) {
    throw new RangeError(`swing must be within [0, 1], got ${p.swing}`);
  }
  if (!Number.isFinite(p.density)) {
    throw new RangeError(`density must be a finite number, got ${p.density}`);
  }
  if (!Number.isInteger(p.rootMidi) || p.rootMidi < MIN_ROOT_MIDI || p.rootMidi > MAX_ROOT_MIDI) {
    throw new RangeError(
      `rootMidi must be an integer in [${MIN_ROOT_MIDI}, ${MAX_ROOT_MIDI}], got ${p.rootMidi}`,
    );
  }
  if (!(p.groove in DRUM_GROOVES)) {
    throw new RangeError(`groove "${p.groove}" is not a known DRUM_GROOVE`);
  }
  // The lead draws raga tones over chords built from the parent; they must share a
  // tuning, so the raga's pitch classes must be a subset of the parent's.
  const parentPcs = new Set(p.parent.map(pitchClass));
  if (!p.raga.every((s) => parentPcs.has(pitchClass(s)))) {
    throw new RangeError("raga must be a pitch-class subset of parent (raga ⊆ parent)");
  }
}

/**
 * Everything a pitched part needs to arrange itself over the shared harmony. Built
 * once per {@link arrange}; the lead line is drawn up front so the arp can double or
 * harmonise it without the parts depending on each other's execution order.
 */
export interface PartContext {
  readonly options: ArrangeOptions;
  readonly plan: HarmonicPlan;
  readonly raga: Scale;
  readonly rootMidi: number;
  readonly beatsPerBar: number;
  readonly bars: number;
  readonly leadMelody: readonly MelodyNote[];
  readonly texture: (typeof TEXTURES)[TextureName];
  readonly bassRng: Rng;
  readonly arpRng: Rng;
  /** Clamp a note so it never rings past the loop point (after swing shifts its start). */
  readonly fit: (start: number, dur: number) => number;
  readonly swung: (beat: number) => number;
  /** Is a section-gated lane (arp/drums dynamic arc) active at this beat? */
  readonly active: (lane: readonly number[], beat: number) => boolean;
}

/**
 * One ensemble voice's arrangement. Registered in {@link PART_ARRANGERS}; a new
 * pitched part joins the arrangement just by adding an entry (plus its instrument
 * pools), the way instruments and styles are data-driven.
 */
export interface PartArranger {
  readonly voice: ScoreVoice;
  readonly arrange: (ctx: PartContext) => ScoreNote[];
}

function arrangeLead(ctx: PartContext): ScoreNote[] {
  return ctx.leadMelody.map((n) => {
    const start = ctx.swung(n.startBeat);
    return {
      startBeat: start,
      durationBeats: ctx.fit(start, n.durationBeats),
      freq: degreeToFrequency(ctx.raga, n.degree, ctx.rootMidi),
      velocity: n.velocity,
    };
  });
}

function arrangeBass(ctx: PartContext): ScoreNote[] {
  const { plan, beatsPerBar, bars, rootMidi, fit, bassRng } = ctx;
  const notes: ScoreNote[] = [];
  const bassPattern = ctx.options.bassPattern ?? "rootFifth";
  // The metric midpoint, snapped to a beat so it lands on-grid in odd meters
  // (4/4 → 2, 6/8 → 3, 3/4 → beat 1); the two halves fill the bar exactly.
  const mid = Math.floor(beatsPerBar / 2);
  const low = (pc: number) => midiToFrequency(rootMidi - OCTAVE + pc); // always below the pad
  for (let bar = 0; bar < bars; bar++) {
    const chord = plan.bars[bar]!.chord;
    const barStart = bar * beatsPerBar;
    const root = chord.root;
    // The chord's ACTUAL fifth (3rd stacked tone), not a blind perfect fifth —
    // a perfect fifth over a diminished/augmented triad is out of key.
    const fifth = chord.pcs[2] ?? chord.root;
    if (bassPattern === "rootFifth") {
      notes.push({
        startBeat: barStart,
        durationBeats: fit(barStart, mid),
        freq: low(root),
        velocity: 0.85,
      });
      const second = bassRng.next() < 0.5 ? root : fifth;
      const midStart = barStart + mid;
      notes.push({
        startBeat: midStart,
        durationBeats: fit(midStart, beatsPerBar - mid),
        freq: low(second),
        velocity: 0.8,
      });
    } else if (bassPattern === "pulse") {
      for (let b = 0; b < beatsPerBar; b++) {
        const at = barStart + b;
        notes.push({
          startBeat: at,
          durationBeats: fit(at, 0.9),
          freq: low(root),
          velocity: b === 0 ? 0.85 : 0.72,
        });
      }
    } else if (bassPattern === "walking") {
      for (let b = 0; b < beatsPerBar; b++) {
        const at = barStart + b;
        notes.push({
          startBeat: at,
          durationBeats: fit(at, 0.9),
          freq: low(chord.pcs[b % chord.pcs.length] ?? root),
          velocity: b === 0 ? 0.85 : 0.75,
        });
      }
    } else {
      // sustained: root held the whole bar
      notes.push({
        startBeat: barStart,
        durationBeats: fit(barStart, beatsPerBar),
        freq: low(root),
        velocity: 0.8,
      });
    }
  }
  return notes;
}

function arrangePad(ctx: PartContext): ScoreNote[] {
  const { plan, beatsPerBar, bars, rootMidi, fit } = ctx;
  const padPattern = ctx.options.padPattern ?? "sustain";
  const notes: ScoreNote[] = [];
  // Voice the pad in root position: the chord root is the lowest tone, the other
  // tones stacked within the octave above it (so the root never lands on top).
  const padVoice = (pc: number, root: number) =>
    midiToFrequency(rootMidi + root + ((pc - root + OCTAVE) % OCTAVE));
  for (let bar = 0; bar < bars; bar++) {
    const chord = plan.bars[bar]!.chord;
    const barStart = bar * beatsPerBar;
    if (padPattern === "stabs") {
      // Rhythmic chord hits on each beat — a driving climax pad.
      for (let b = 0; b < beatsPerBar; b++) {
        const at = barStart + b;
        for (const pc of chord.pcs) {
          notes.push({
            startBeat: at,
            durationBeats: fit(at, 0.4),
            freq: padVoice(pc, chord.root),
            velocity: 0.32,
          });
        }
      }
    } else if (padPattern === "broken") {
      // Chord tones enter one per beat, each held to the bar end — gentle bridge movement.
      chord.pcs.forEach((pc, i) => {
        const at = barStart + Math.min(i, beatsPerBar - 1);
        notes.push({
          startBeat: at,
          durationBeats: fit(at, beatsPerBar - (at - barStart)),
          freq: padVoice(pc, chord.root),
          velocity: 0.3,
        });
      });
    } else {
      // sustain: whole-bar block chord (default).
      const dur = fit(barStart, beatsPerBar);
      for (const pc of chord.pcs) {
        notes.push({
          startBeat: barStart,
          durationBeats: dur,
          freq: padVoice(pc, chord.root),
          velocity: 0.3,
        });
      }
    }
  }
  return notes;
}

function arrangeArp(ctx: PartContext): ScoreNote[] {
  const { plan, beatsPerBar, bars, rootMidi, raga, fit, swung, active, texture, arpRng } = ctx;
  const arpRole = ctx.options.arpRole ?? "arp";
  if (arpRole === "double" || arpRole === "harmony") {
    // Orchestration: the arp instrument follows the THEME instead of arpeggiating —
    // doubling it an octave up (a tutti climax) or harmonising it a third below (a
    // two-part bridge). Tracks the lead, so it sits in the same phrasing.
    const octave = arpRole === "double" ? OCTAVE : 0;
    return ctx.leadMelody.map((n): ScoreNote => {
      const start = swung(n.startBeat);
      const degree = arpRole === "harmony" ? thirdBelow(raga, n.degree) : n.degree;
      return {
        startBeat: start,
        durationBeats: fit(start, n.durationBeats),
        freq: degreeToFrequency(raga, degree, rootMidi + octave),
        velocity: n.velocity * 0.7, // sits just under the lead
      };
    });
  }
  if (arpRole === "counter") {
    // A slow counter-line: one chord tone every two beats, wandering through a register
    // band beneath the lead — a second melodic voice that converses with the busy theme
    // by moving against it at a contrasting pace. Chord tones keep it consonant with the
    // lead's chord-tone strong beats; it steps to the nearest tone but avoids repeating,
    // so it actually moves instead of pedalling.
    const counter: ScoreNote[] = [];
    const stride = 2; // beats between counter notes
    const loBand = rootMidi - 2;
    const hiBand = rootMidi + OCTAVE - 3; // a tenor band that stays under the lead's soprano
    let prevMidi = rootMidi + 2;
    for (let bar = 0; bar < bars; bar++) {
      const pcs = plan.bars[bar]!.chord.pcs;
      const cands = pcs
        .flatMap((pc) => [rootMidi + pc, rootMidi + pc + OCTAVE])
        .filter((m) => m >= loBand && m <= hiBand);
      for (let b = 0; b < beatsPerBar; b += stride) {
        const start = swung(bar * beatsPerBar + b);
        if (!active(texture.arp, start)) continue;
        let pick = cands[0] ?? rootMidi;
        let best = Infinity;
        for (const m of cands) {
          const cost = Math.abs(m - prevMidi) + (m === prevMidi ? 5 : 0); // nudge it off a repeat
          if (cost < best) {
            best = cost;
            pick = m;
          }
        }
        counter.push({
          startBeat: start,
          durationBeats: fit(start, stride * 0.95),
          freq: midiToFrequency(pick),
          velocity: 0.4,
        });
        prevMidi = pick;
      }
    }
    return counter;
  }
  const notes: ScoreNote[] = [];
  const pattern = arpRng.pick(ARP_PATTERNS);
  const stepsPerBar = beatsPerBar * 2; // eighth notes, so swing bites
  for (let bar = 0; bar < bars; bar++) {
    const seq = arpSequence(plan.bars[bar]!.chord.pcs, pattern);
    for (let s = 0; s < stepsPerBar; s++) {
      const pc = seq[s % seq.length]!;
      const start = swung(bar * beatsPerBar + s * 0.5);
      if (!active(texture.arp, start)) continue; // gated out this section
      notes.push({
        startBeat: start,
        durationBeats: fit(start, 0.45),
        freq: midiToFrequency(rootMidi + OCTAVE + pc),
        velocity: 0.45,
      });
    }
  }
  return notes;
}

/**
 * The ensemble's pitched voices, arranged in this order (also their order in the
 * Score). Drums are arranged separately — they're a kit + groove, not a melodic line.
 */
export const PART_ARRANGERS: readonly PartArranger[] = [
  { voice: "lead", arrange: arrangeLead },
  { voice: "bass", arrange: arrangeBass },
  { voice: "pad", arrange: arrangePad },
  { voice: "arp", arrange: arrangeArp },
];

/**
 * Bars a theme occupies, for a caller that hands one in without declaring its span.
 * Measuring it beats assuming none: a zero span would let the generated continuation
 * start on top of the theme instead of after it.
 */
function themeSpanBars(motif: readonly MelodyNote[], beatsPerBar: number): number {
  const end = Math.max(...motif.map((n) => n.startBeat + n.durationBeats));
  return Math.max(1, Math.ceil(end / beatsPerBar));
}

/** Compose a {@link Score} from a harmony plan, melody, and groove. Pure & deterministic. */
export function arrange(options: ArrangeOptions): Score {
  const { rng } = options;
  const bpm = options.bpm ?? 100;
  const beatsPerBar = options.beatsPerBar ?? 4;
  const bars = options.bars ?? 8;
  const parent = options.parent ?? SCALES.major;
  const raga = options.raga ?? parent;
  const rootMidi = options.rootMidi ?? DEFAULT_ROOT_MIDI;
  const groove = options.groove ?? "straight";
  const density = options.density ?? 0.5;
  const swing = options.swing ?? 0;
  const leadRange = options.leadRange ?? ([0, 7] as const);

  if (!Number.isFinite(bpm) || bpm <= 0) {
    throw new RangeError(`arrange bpm must be a positive number, got ${bpm}`);
  }
  assertMusicalParams({ swing, density, rootMidi, groove, parent, raga });

  const lengthBeats = bars * beatsPerBar;
  const enabled = (v: ScoreVoice) => options.voices?.[v] ?? true;
  const drumsOn = options.voices?.drums ?? true;
  // Clamp a note so it never rings past the loop point (after swing has shifted its start).
  const fit = (start: number, dur: number) => Math.min(dur, lengthBeats - start);
  const swung = (beat: number) => applySwing(beat, swing);
  // Dynamic arc: is the arp/drums lane active in the section a beat falls in?
  const texture = TEXTURES[options.texture ?? "full"];
  const sectionOf = (beat: number) =>
    Math.min(TEXTURE_SECTIONS - 1, Math.floor((beat / lengthBeats) * TEXTURE_SECTIONS));
  const active = (lane: readonly number[], beat: number) => lane[sectionOf(beat)] !== 0;

  // Fork per voice in a fixed order so toggling/retuning one voice can't reshuffle another.
  const harmonyRng = rng.fork();
  const leadRng = rng.fork();
  const bassRng = rng.fork();
  const arpRng = rng.fork();

  // Reuse a caller-supplied plan (gentle evolve: fixed harmony, varying melody) or
  // build one. The harmonyRng fork above is kept either way so the lead/bass/arp
  // fork positions — and thus determinism for a given rng — don't shift.
  const plan =
    options.plan ??
    generateHarmony({
      rng: harmonyRng,
      scale: parent,
      rootMidi,
      bars,
      beatsPerBar,
      ...(options.progression !== undefined ? { progression: options.progression } : {}),
      ...(options.generateProgression !== undefined
        ? { generate: options.generateProgression }
        : {}),
    });

  // Develop the theme for this section before it is stated — same tune, transformed.
  const theme =
    options.motif && options.motif.length > 0
      ? developMotif(options.motif, options.development ?? PLAIN_STATEMENT, {
          beatsPerBar,
          motifBars: options.motifBars ?? themeSpanBars(options.motif, beatsPerBar),
          sectionBars: bars,
          range: leadRange,
          degreesPerOctave: raga.length,
          maxLeap: DEFAULT_MAX_LEAP,
        })
      : null;

  // Draw the lead line up front: the lead part renders it and the arp may double or
  // harmonise it, so it can't live inside a single part's arranger.
  const leadMelody: readonly MelodyNote[] = enabled("lead")
    ? generateMelody({
        rng: leadRng,
        plan,
        scale: raga,
        range: leadRange,
        density,
        ...(options.paths !== undefined ? { paths: options.paths } : {}),
        ...(options.contour !== undefined ? { contour: options.contour } : {}),
        ...(theme ? { motif: theme.notes, motifBars: theme.bars } : {}),
      })
    : [];

  const ctx: PartContext = {
    options,
    plan,
    raga,
    rootMidi,
    beatsPerBar,
    bars,
    leadMelody,
    texture,
    bassRng,
    arpRng,
    fit,
    swung,
    active,
  };
  const parts: ScorePart[] = [];
  for (const part of PART_ARRANGERS) {
    if (enabled(part.voice)) parts.push({ voice: part.voice, notes: part.arrange(ctx) });
  }

  let drums: DrumHit[] = [];
  if (drumsOn) {
    const g = fitGroove(DRUM_GROOVES[groove], beatsPerBar);
    const lanes: ReadonlyArray<readonly [DrumName, readonly number[], number]> = [
      ["kick", g.kick, 1],
      ["snare", g.snare, 0.9],
      ["hat", g.hat, 0.45],
    ];
    for (let bar = 0; bar < bars; bar++) {
      for (const [drum, positions, velocity] of lanes) {
        for (const pos of positions) {
          const raw = bar * beatsPerBar + pos;
          const beat = drum === "hat" ? swung(raw) : raw;
          if (!active(texture.drums, beat)) continue; // gated out this section
          drums.push({ startBeat: beat, drum, velocity });
        }
      }
    }
    if (options.fill) {
      // Replace the final bar with a snare buildup → announces the part change.
      const lastBar = (bars - 1) * beatsPerBar;
      drums = drums.filter((h) => h.startBeat < lastBar);
      drums.push({ startBeat: lastBar, drum: "kick", velocity: 1 });
      const steps = beatsPerBar * 2; // eighth notes
      for (let s = 0; s < steps; s++) {
        drums.push({
          startBeat: lastBar + s * 0.5,
          drum: "snare",
          velocity: 0.45 + 0.55 * (s / Math.max(1, steps - 1)), // crescendo into the next section
        });
      }
    }
  }

  // Dynamics: scale the whole section's velocities for the loud/soft arc.
  const dynamics = options.dynamics ?? 1;
  if (dynamics !== 1) {
    const scale = (v: number) => Math.min(1, v * dynamics);
    return {
      bpm,
      beatsPerBar,
      bars,
      lengthBeats,
      rootMidi,
      parts: parts.map((p) => ({
        voice: p.voice,
        notes: p.notes.map((n) => ({ ...n, velocity: scale(n.velocity) })),
      })),
      drums: drums.map((h) => ({ ...h, velocity: scale(h.velocity) })),
    };
  }

  return { bpm, beatsPerBar, bars, lengthBeats, rootMidi, parts, drums };
}
