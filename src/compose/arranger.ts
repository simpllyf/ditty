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
import { type HarmonicPlan, chordAt, generateHarmony } from "./harmony";
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
  /**
   * Begin this many cents away from `freq` and slide to it — a note reached by
   * sliding rather than by being struck. Negative slides up to the pitch, positive
   * down. Absent on most notes; see {@link SLIDE_MIN_SEMITONES}.
   */
  readonly slideFromCents?: number;
  /** How long the slide takes, in seconds. Present whenever `slideFromCents` is. */
  readonly slideSeconds?: number;
  /** Oscillate up to a neighbouring swara and back, this many cents away. */
  readonly shakeCents?: number;
  /** Swings per second. */
  readonly shakeRateHz?: number;
  /** Ease the shake in over this long, so the note arrives clean and then moves. */
  readonly shakeDelaySeconds?: number;
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
  /**
   * Reverb-send multiplier for the whole section — the depth arc. Above 1 pushes the
   * section back into a larger, wetter space (a distant, intimate intro or bridge); below
   * 1 pulls it forward, present and dry (the climax, up front). Default 1 (unscaled).
   */
  readonly reverbScale?: number;
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
  /** Scale degrees (0..6) voiced with their diatonic seventh. */
  sevenths?: readonly number[];
  /** Allow an occasional secondary dominant (V7 of a diatonic target). */
  secondaryDominants?: boolean;
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
  /**
   * When set, the level ramps linearly from {@link dynamics} at the section's head to this at
   * its tail — a crescendo (or diminuendo) built into the bars, so a build section swells into
   * the part that follows. Default: no ramp (flat at {@link dynamics}).
   */
  dynamicsTo?: number;
  /** Reverb-send multiplier for the section — the depth arc. Passed onto the {@link Score}. Default 1. */
  reverbScale?: number;
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
  /**
   * Let the lead slide into wide leaps rather than jumping to them. Only for
   * instruments that sustain — a struck bar has decayed before a slide could land.
   * Default false.
   */
  slide?: boolean;
  /**
   * Let a held note oscillate toward its neighbouring swara — the shake a raga's long
   * notes carry. Only for instruments that sustain. Default false.
   */
  shake?: boolean;
  /**
   * Raga mode: the harmony is a fixed Sa+Pa drone. The arp voice becomes a tanpura —
   * plucking the Pa·Sa·Sa·low-Sa string cycle instead of arpeggiating — and the bass is
   * pulled back so it underpins the drone rather than dominating the mix. Default false.
   */
  drone?: boolean;
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

/** Tempo when the caller names none. */
const DEFAULT_BPM = 100;

/**
 * A note has to be held to be shaken. At the rate below this is a little under three
 * swings — fewer and it reads as an out-of-tune attack rather than as movement. It also
 * keeps the shake a gesture in slow styles: at 0.45s a third of ambient's notes shook,
 * which is a tremble, not an ornament.
 */
const SHAKE_MIN_SECONDS = 0.6;
/** Swings per second — slow enough to hear as movement between two pitches. */
const SHAKE_RATE_HZ = 4.6;
/**
 * How far toward the next swara the oscillation reaches. Not all the way: a shake that
 * arrives fully on the neighbour stops being an inflection of THIS note and becomes a
 * trill between two.
 */
const SHAKE_REACH = 0.62;
/** Even a wide-stepping raga keeps the swing within this, or the pitch stops reading. */
const SHAKE_MAX_CENTS = 170;
/** Ease-in, as a share of the note — it lands clean, then moves. */
const SHAKE_EASE = 0.22;

/**
 * A leap is jumped to unless it is wide enough to be worth connecting. Below this the
 * line is already stepping and a slide would only smear it.
 */
export const SLIDE_MIN_SEMITONES = 4;
/**
 * A slide APPROACHES an arrival — a meend leans into a note that lands and is dwelt on,
 * not into every passing tone. A note counts as an arrival when it falls on a strong
 * beat or is held at least this long; sliding into a short note on a weak beat is a
 * smear, not a gesture. (The line still leaps there — it just doesn't glide.)
 */
const SLIDE_ARRIVAL_BEATS = 1;
/** A slide is a gesture, not a journey: long enough to hear, short enough to arrive. */
const SLIDE_BASE_SECONDS = 0.05;
const SLIDE_PER_SEMITONE = 0.015;
const SLIDE_MAX_SECONDS = 0.16;

function arrangeLead(ctx: PartContext): ScoreNote[] {
  const secondsPerBeat = 60 / (ctx.options.bpm ?? DEFAULT_BPM);
  const semitoneOf = (degree: number) => degreeToSemitone(ctx.raga, degree);

  return ctx.leadMelody
    .map((n, i) => {
      const start = ctx.swung(n.startBeat);
      const durationBeats = ctx.fit(start, n.durationBeats);
      const note: ScoreNote = {
        startBeat: start,
        durationBeats,
        freq: degreeToFrequency(ctx.raga, n.degree, ctx.rootMidi),
        velocity: n.velocity,
      };
      if (!ctx.options.slide) return note;

      // A slide CONNECTS two notes, so it needs one to come from: the previous note has
      // to run right up to this one. Across a rest the line has already let go, and
      // sliding out of silence is a swoop, not a phrase.
      const prev = ctx.leadMelody[i - 1];
      if (!prev || prev.startBeat + prev.durationBeats < n.startBeat - 1e-9) return note;

      const leap = semitoneOf(n.degree) - semitoneOf(prev.degree);
      if (Math.abs(leap) < SLIDE_MIN_SEMITONES) return note;

      // Slide only into an arrival — a note the line lands on, not a passing one. On a
      // strong beat, or held long enough to be dwelt on.
      if (!n.strong && durationBeats < SLIDE_ARRIVAL_BEATS) return note;

      const seconds = Math.min(
        SLIDE_MAX_SECONDS,
        SLIDE_BASE_SECONDS + Math.abs(leap) * SLIDE_PER_SEMITONE,
      );
      // The note must outlast its own approach, or the slide IS the note.
      if (durationBeats * secondsPerBeat < seconds * 3) return note;

      return { ...note, slideFromCents: -leap * 100, slideSeconds: seconds };
    })
    .map((note, i) => {
      if (!ctx.options.shake) return note;
      const held = note.durationBeats * secondsPerBeat;
      if (held < SHAKE_MIN_SECONDS) return note;

      const degree = ctx.leadMelody[i]!.degree;
      // Sa and Pa are the achala swaras — the fixed tonic and its fifth. They are the
      // reference the shake moves AGAINST, the anchor of the drone, so they stay steady
      // while the moving swaras (Ri, Ga, Ma, Da, Ni) carry the kampita. Read the pitch
      // class from the tonic: 0 is Sa, 7 is Pa.
      const pc = ((semitoneOf(degree) % OCTAVE) + OCTAVE) % OCTAVE;
      if (pc === 0 || pc === 7) return note;

      // The DEPTH is the raga's own: the distance to the next swara above. That is what
      // makes this an oscillation between two notes of the raga rather than a vibrato of
      // some chosen width — a pentatonic shakes wider than a heptatonic because its
      // neighbours sit further apart, which is exactly right.
      const toNeighbour = semitoneOf(degree + 1) - semitoneOf(degree);
      const cents = Math.min(SHAKE_MAX_CENTS, toNeighbour * 100 * SHAKE_REACH);
      if (cents < 40) return note; // too narrow to hear as movement

      return {
        ...note,
        shakeCents: cents,
        shakeRateHz: SHAKE_RATE_HZ,
        shakeDelaySeconds: Math.min(0.25, held * SHAKE_EASE),
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
    const barPlan = plan.bars[bar]!;
    const chord = barPlan.chord;
    // The bar already divides here, so a split bar simply gives each half its chord.
    const barStart = bar * beatsPerBar;
    const root = chord.root;
    // The chord's ACTUAL fifth (3rd stacked tone), not a blind perfect fifth —
    // a perfect fifth over a diminished/augmented triad is out of key.
    /** The chord under this beat, and its ACTUAL fifth (3rd stacked tone) — a blind
     * perfect fifth over a diminished or augmented triad would be out of key. */
    const under = (beat: number) => {
      const c = chordAt(barPlan, beat - barStart, beatsPerBar);
      return { root: c.root, fifth: c.pcs[2] ?? c.root, pcs: c.pcs };
    };
    if (bassPattern === "rootFifth") {
      notes.push({
        startBeat: barStart,
        durationBeats: fit(barStart, mid),
        freq: low(root),
        velocity: 0.85,
      });
      const half = under(barStart + mid);
      const second = bassRng.next() < 0.5 ? half.root : half.fifth;
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
          freq: low(under(at).root),
          velocity: b === 0 ? 0.85 : 0.72,
        });
      }
    } else if (bassPattern === "walking") {
      for (let b = 0; b < beatsPerBar; b++) {
        const at = barStart + b;
        notes.push({
          startBeat: at,
          durationBeats: fit(at, 0.9),
          freq: low(under(at).pcs[b % under(at).pcs.length] ?? under(at).root),
          velocity: b === 0 ? 0.85 : 0.75,
        });
      }
    } else {
      // sustained: the root held for the bar, or for each half of a split one
      const spans: readonly (readonly [number, number])[] = barPlan.second
        ? [
            [barStart, mid],
            [barStart + mid, beatsPerBar - mid],
          ]
        : [[barStart, beatsPerBar]];
      for (const [beat, span] of spans) {
        notes.push({
          startBeat: beat,
          durationBeats: fit(beat, span),
          freq: low(under(beat).root),
          velocity: 0.8,
        });
      }
    }
  }
  return notes;
}

/**
 * Voice a chord next to the one before it: each tone takes the pitch nearest the
 * previous voicing, so a tone the two chords share simply stays where it is and
 * everything else moves by the shortest step available. Ties go to the voicing
 * closest to the middle of the band, which keeps the pad from drifting to an edge.
 *
 * Re-stacking every chord from its root instead — the obvious way — makes the pad
 * lurch, and moves its outer voices in parallel fifths on every change, because
 * root position always spaces them the same way.
 */
function voiceLead(
  pcs: readonly number[],
  prev: readonly number[],
  rootMidi: number,
  hi: number,
): number[] {
  const centre = (rootMidi + hi) / 2;
  const voiced = pcs.map((pc) => {
    // Chord tones are pitch classes RELATIVE TO THE TONIC, so every placement of this
    // tone is rootMidi + pc, an octave at a time.
    const base = rootMidi + (((pc % OCTAVE) + OCTAVE) % OCTAVE);
    let best = base;
    let bestNear = Infinity;
    let bestCentre = Infinity;
    for (let midi = base; midi <= hi; midi += OCTAVE) {
      const near = prev.length === 0 ? 0 : Math.min(...prev.map((p) => Math.abs(p - midi)));
      const fromCentre = Math.abs(midi - centre);
      if (near < bestNear || (near === bestNear && fromCentre < bestCentre)) {
        best = midi;
        bestNear = near;
        bestCentre = fromCentre;
      }
    }
    return best;
  });
  return openLowClusters(voiced, hi);
}

/**
 * Open any minor-second cluster low in the voicing by lifting the upper of the pair an
 * octave, when there is room. A major seventh sits a semitone under the octave, and
 * nearest-note voice-leading can land it right against the root down where it muddies;
 * spreading the two keeps the seventh's colour without the low beat. Only the low pairs
 * — a close major seventh up high is bright, not muddy.
 */
function openLowClusters(voicing: readonly number[], hi: number): number[] {
  const out = [...voicing].sort((a, b) => a - b);
  for (let i = 0; i + 1 < out.length; i++) {
    const lo = out[i]!;
    const up = out[i + 1]!;
    if (up - lo === 1 && lo < 60 && up + OCTAVE <= hi) {
      out[i + 1] = up + OCTAVE;
      out.sort((a, b) => a - b);
      i = -1; // a lift can create a new adjacency — rescan from the bottom
    }
  }
  return out;
}

function arrangePad(ctx: PartContext): ScoreNote[] {
  const { plan, beatsPerBar, bars, rootMidi, fit } = ctx;
  const padPattern = ctx.options.padPattern ?? "sustain";
  const notes: ScoreNote[] = [];
  // The pad's register: above the bass (which never rises past rootMidi - 1) and
  // within two octaves of the tonic.
  const padHi = rootMidi + 2 * OCTAVE;
  const mid = Math.floor(beatsPerBar / 2); // where a split bar changes chord
  // Open in root position — that states the harmony plainly — then lead the voices
  // from bar to bar. A seventh chord voices all four tones: keeping the fifth gives the
  // next chord more common tones to hold, so the pad moves LESS, not more; the low
  // major-seventh cluster it would otherwise make is opened by voiceLead's declutter.
  const opening = plan.bars[0]!.chord;
  let voicing = opening.pcs.map(
    (pc) => rootMidi + opening.root + ((pc - opening.root + OCTAVE) % OCTAVE),
  );
  for (let bar = 0; bar < bars; bar++) {
    const barPlan = plan.bars[bar]!;
    const barStart = bar * beatsPerBar;
    if (bar > 0) voicing = voiceLead(barPlan.chord.pcs, voicing, rootMidi, padHi);
    // A split bar is voiced twice, the second half led from the first — the pad has to
    // move with the harmony or it holds a chord the rest of the band has left behind.
    const late = barPlan.second
      ? voiceLead(barPlan.second.chord.pcs, voicing, rootMidi, padHi)
      : null;
    /** The voicing sounding at this point in the bar. */
    const at = (beat: number) => (late && beat - barStart >= mid ? late : voicing);

    if (padPattern === "stabs") {
      // Rhythmic chord hits on each beat — a driving climax pad.
      for (let b = 0; b < beatsPerBar; b++) {
        const beat = barStart + b;
        for (const midi of at(beat)) {
          notes.push({
            startBeat: beat,
            durationBeats: fit(beat, 0.4),
            freq: midiToFrequency(midi),
            velocity: 0.32,
          });
        }
      }
    } else if (padPattern === "broken") {
      // Chord tones enter one per beat, each held to the end of its half — gentle
      // bridge movement that still gives way when the harmony moves.
      const until = late ? [mid, beatsPerBar] : [beatsPerBar];
      let from = 0;
      for (const edge of until) {
        const voices = at(barStart + from);
        voices.forEach((midi, i) => {
          const beat = barStart + Math.min(from + i, edge - 1);
          notes.push({
            startBeat: beat,
            durationBeats: fit(beat, barStart + edge - beat),
            freq: midiToFrequency(midi),
            velocity: 0.3,
          });
        });
        from = edge;
      }
    } else {
      // sustain: a block chord held for the bar, or for each half of a split one.
      const spans: readonly (readonly [number, number])[] = late
        ? [
            [barStart, mid],
            [barStart + mid, beatsPerBar - mid],
          ]
        : [[barStart, beatsPerBar]];
      for (const [beat, span] of spans) {
        const dur = fit(beat, span);
        for (const midi of at(beat)) {
          notes.push({
            startBeat: beat,
            durationBeats: dur,
            freq: midiToFrequency(midi),
            velocity: 0.3,
          });
        }
      }
    }
  }
  return notes;
}

/**
 * The tanpura's plucked cycle, as semitone offsets from Sa: Pa · Sa · Sa · Sa. Pa is the
 * fourth below the tonic; the strings stay in the tonic's own octave (mid-range) so their
 * harmonics fill the mid — the low mandra Sa is left to the bass, and doubling it here only
 * piles more energy onto the one low tone the mix is already heavy with.
 */
const TANPURA_CYCLE = [-5, 0, 0, 0] as const;

function arrangeArp(ctx: PartContext): ScoreNote[] {
  const { plan, beatsPerBar, bars, rootMidi, raga, fit, swung, active, texture, arpRng } = ctx;

  if (ctx.options.drone) {
    // Raga mode: a tanpura, not an arpeggio. Pluck one string per beat through the
    // Pa·Sa·Sa·low-Sa cycle; each rings ~two beats (the patch's long release carries the
    // tail) so the plucks overlap into a continuous drone. Steady — no swing, no section
    // gating: a drone that dropped out on a breakdown bar would stop being a drone.
    const notes: ScoreNote[] = [];
    for (let bar = 0; bar < bars; bar++) {
      for (let b = 0; b < beatsPerBar; b++) {
        const start = bar * beatsPerBar + b;
        notes.push({
          startBeat: start,
          durationBeats: fit(start, 2),
          freq: midiToFrequency(rootMidi + TANPURA_CYCLE[start % TANPURA_CYCLE.length]!),
          velocity: 0.7, // forward enough to carry the drone in front of the bass
        });
      }
    }
    return notes;
  }

  const arpRole = ctx.options.arpRole ?? "arp";
  // Both theme-following roles need a theme. With the lead switched off there is
  // nothing to double or harmonise, so the arp keeps its own figure rather than
  // falling silent on a voice the caller asked to hear.
  if ((arpRole === "double" || arpRole === "harmony") && ctx.leadMelody.length > 0) {
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
    // A true second voice: it ANSWERS the lead. The lead breathes — its rhythm leaves
    // real rests — and this line speaks into those silences, so the two parts trade
    // phrases instead of talking over each other. Where they do overlap it moves against
    // the lead, because two lines that move apart are heard as two lines. Chord tones
    // keep it consonant; a tenor band keeps it under the lead's soprano.
    const counter: ScoreNote[] = [];
    const stride = 2; // the counter's pace: it answers phrases, not every micro-gap
    const loBand = rootMidi - 2;
    const hiBand = rootMidi + OCTAVE - 3; // a tenor band that stays under the lead's soprano
    const lead = ctx.leadMelody;
    const leadMidi = (n: MelodyNote) => rootMidi + degreeToSemitone(raga, n.degree);

    /** Is the lead sounding here? Its rests are where this voice gets to speak. */
    const leadSounds = (beat: number) =>
      lead.some((n) => n.startBeat <= beat + 1e-9 && n.startBeat + n.durationBeats > beat + 1e-9);
    /** The lead note in force at `beat`, plus which way it just moved. */
    const leadAt = (beat: number) => {
      let last: MelodyNote | null = null;
      let prior: MelodyNote | null = null;
      for (const n of lead) {
        if (n.startBeat > beat + 1e-9) break;
        prior = last;
        last = n;
      }
      return { last, step: last && prior ? Math.sign(last.degree - prior.degree) : 0 };
    };

    let prevMidi = rootMidi + 2;
    let prevLead: number | null = null;
    for (let bar = 0; bar < bars; bar++) {
      const barPlan = plan.bars[bar]!;
      const tonesAt = (beat: number) =>
        chordAt(barPlan, beat - bar * beatsPerBar, beatsPerBar)
          .pcs.flatMap((pc) => [rootMidi + pc, rootMidi + pc + OCTAVE])
          .filter((m) => m >= loBand && m <= hiBand);
      if (tonesAt(bar * beatsPerBar).length === 0) continue;

      // The line keeps its own pulse — a note every `stride` beats — and each one
      // shifts to the nearest beat inside its slot where the lead is silent. Answering
      // the theme must not cost the counter its rhythm: entries free to land wherever
      // the lead happens to breathe leave a scatter of notes, not a line.
      const barStart = bar * beatsPerBar;
      const entries: number[] = [];
      for (let b = 0; b < beatsPerBar; b += stride) {
        const slot = barStart + b;
        let at = slot;
        for (let k = 0; k < stride && slot + k < barStart + beatsPerBar; k++) {
          if (!leadSounds(slot + k)) {
            at = slot + k;
            break;
          }
        }
        entries.push(at);
      }

      for (const at of entries) {
        const start = swung(at);
        if (!active(texture.arp, start)) continue;
        // Give way when the lead comes back in: hold only until it does.
        const next = lead.find((n) => n.startBeat > at + 1e-9);
        const room = next ? Math.min(stride, next.startBeat - at) : stride;
        const { last, step } = leadAt(at);
        const here = last ? leadMidi(last) : null;

        const cands = tonesAt(at);
        if (cands.length === 0) continue;
        let pool = cands.filter((m) => m !== prevMidi);
        if (pool.length === 0) pool = cands;
        // Move against the lead where a chord tone allows it…
        const contrary = pool.filter((m) => step === 0 || Math.sign(m - prevMidi) !== step);
        if (contrary.length > 0) pool = contrary;
        // …and never into a parallel fifth or octave with it.
        if (here !== null && prevLead !== null) {
          const wasApart = Math.abs(prevLead - prevMidi) % OCTAVE;
          const clean = pool.filter(
            (m) =>
              !(
                (wasApart === 7 || wasApart === 0) &&
                Math.abs(here - m) % OCTAVE === wasApart &&
                m !== prevMidi &&
                here !== prevLead
              ),
          );
          if (clean.length > 0) pool = clean;
        }
        const pick = pool.reduce(
          (best, m) => (Math.abs(m - prevMidi) < Math.abs(best - prevMidi) ? m : best),
          pool[0] as number,
        );

        counter.push({
          startBeat: start,
          durationBeats: fit(start, Math.max(0.5, room) * 0.95),
          freq: midiToFrequency(pick),
          velocity: 0.4,
        });
        prevMidi = pick;
        prevLead = here;
      }
    }
    return counter;
  }
  const notes: ScoreNote[] = [];
  const pattern = arpRng.pick(ARP_PATTERNS);
  const stepsPerBar = beatsPerBar * 2; // eighth notes, so swing bites
  for (let bar = 0; bar < bars; bar++) {
    const barPlan = plan.bars[bar]!;
    const early = arpSequence(barPlan.chord.pcs, pattern);
    // The same figure over the second chord, so a split bar keeps its shape while the
    // harmony underneath it moves.
    const late = barPlan.second ? arpSequence(barPlan.second.chord.pcs, pattern) : early;
    for (let s = 0; s < stepsPerBar; s++) {
      const seq = s * 0.5 >= Math.floor(beatsPerBar / 2) ? late : early;
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
  const bpm = options.bpm ?? DEFAULT_BPM;
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
      ...(options.sevenths !== undefined ? { sevenths: options.sevenths } : {}),
      ...(options.secondaryDominants !== undefined
        ? { secondaryDominants: options.secondaryDominants }
        : {}),
      ...(options.drone ? { drone: true } : {}),
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

  // Dynamics: the section's loud/soft scale, plus a phrase swell on the PITCHED voices —
  // they breathe as one, rising toward the middle of each phrase and easing off, so a
  // piece rises and falls instead of sitting at one level. The drums stay out of it: the
  // beat is the steady anchor the melody breathes over, and a swelling kit only pumps.
  // The level can RAMP across the section: from `dynamics` at the head to `dynamicsTo` at the
  // tail. A build section swells into the part after it instead of stepping up flat — and the
  // ramp is heard even under the master limiter, because its soft start sits below the ceiling
  // the loud end hits. Absent a target, the level is the flat scale (unchanged).
  const dynamicsFrom = options.dynamics ?? 1;
  const dynamicsTo = options.dynamicsTo ?? dynamicsFrom;
  const level = (beat: number) =>
    dynamicsFrom + (dynamicsTo - dynamicsFrom) * (lengthBeats > 0 ? beat / lengthBeats : 0);
  const swell = (beat: number) =>
    1 + PHRASE_SWELL * (2 * Math.sin(Math.PI * phrasePosition(beat, beatsPerBar)) - 1);
  const pitched = (v: number, beat: number) => Math.min(1, v * level(beat) * swell(beat));
  const struck = (v: number, beat: number) => Math.min(1, v * level(beat));
  // Raga mode: pull the bass back so the tanpura carries the drone. A sine sub-bass holding
  // Sa otherwise piles ~90% of the mix onto one low tone — boomy, and enough to make a small
  // speaker distort; a gentler bass lets the tanpura's mid-rich shimmer sit in front.
  const DRONE_BASS = 0.4;
  const voiceGain = (voice: ScoreVoice) => (options.drone && voice === "bass" ? DRONE_BASS : 1);

  return {
    bpm,
    beatsPerBar,
    bars,
    lengthBeats,
    rootMidi,
    parts: parts.map((p) => ({
      voice: p.voice,
      notes: p.notes.map((n) => ({
        ...n,
        velocity: pitched(n.velocity * voiceGain(p.voice), n.startBeat),
      })),
    })),
    drums: drums.map((h) => ({ ...h, velocity: struck(h.velocity, h.startBeat) })),
    ...(options.reverbScale !== undefined ? { reverbScale: options.reverbScale } : {}),
  };
}

/** Bars a phrase spans — the swell arcs over this. */
const PHRASE_BARS = 4;
/** How far the phrase swell lifts and dips the velocity at its peak and edges. */
const PHRASE_SWELL = 0.14;

/**
 * Where a beat falls within its phrase, 0..1. The swell arcs over this: softer at the
 * phrase edges, fullest in the middle. A section shorter than a phrase is one phrase.
 */
function phrasePosition(beat: number, beatsPerBar: number): number {
  const phraseLen = PHRASE_BARS * beatsPerBar;
  return (((beat % phraseLen) + phraseLen) % phraseLen) / phraseLen;
}
