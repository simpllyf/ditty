/**
 * The brain — an infinite, pull-based stream of musical events.
 *
 * `MelodyStream.next()` returns one bar of {@link NoteEvent}s at a time. It
 * knows nothing about wall-clock time, audio, or scheduling; the scheduler pulls
 * from it as its buffer drains. Given a seed it is fully deterministic.
 *
 * How a bar is built:
 *  - **Rhythm** comes from {@link generateBar} (durations that tile the bar).
 *  - **Pitch** is a constrained first-order walk over scale degrees: each step is
 *    drawn from an interval distribution that favours stepwise motion, biased
 *    toward the current {@link contourTarget}, capped by {@link capLeap}, kept in
 *    range, and guarded against stale repeats.
 *  - **Structure** is AABA: a motif `A` recurs (transposed, with light
 *    variation) around a contrasting `B`, so the music feels composed rather
 *    than noodly, while every bar still resolves onto a stable tone.
 *  - **Layers**: a gentle root/fifth bass on the downbeats and an optional light
 *    arpeggio, all drawn from the same scale.
 */
import {
  type ContourShape,
  DEFAULT_MAX_LEAP,
  DEFAULT_MAX_NOTE_REPEAT,
  ShuffleBag,
  capLeap,
  contourTarget,
  exceedsRepeatLimit,
  isStableDegree,
  nearestStableDegree,
} from "./constraints";
import { type RhythmConfig, DEFAULT_RHYTHM, generateBar, stepsToBeats } from "./rhythm";
import type { Rng } from "./rng";
import { type Scale, SCALES, degreeToFrequency, degreeToSemitone } from "./scale";

/** Which synth layer a note belongs to. */
export type Voice = "lead" | "bass" | "arp";

/** A single note, expressed in beats and Hz — no audio, no wall-clock time. */
export interface NoteEvent {
  /** Absolute start, in beats from the stream's first note. */
  readonly startBeat: number;
  /** Duration in beats. */
  readonly durationBeats: number;
  /** Pitch in Hz (always a tone of the chosen scale). */
  readonly frequency: number;
  /** Loudness, 0..1. */
  readonly velocity: number;
  /** The layer this note plays on. */
  readonly voice: Voice;
}

/** Options for a {@link MelodyStream}. Only `rng` is required. */
export interface MelodyOptions {
  /** The seeded PRNG. Required — it is the source of all variation. */
  rng: Rng;
  /** Scale to draw from. Default: major pentatonic. */
  scale?: Scale;
  /** MIDI note of the tonic (the lead's register). Default: 72 (C5). */
  rootMidi?: number;
  /** Rhythm grid + duration weights. Default: {@link DEFAULT_RHYTHM}. */
  rhythm?: RhythmConfig;
  /** Maximum jump between consecutive lead notes, in scale degrees. */
  maxLeap?: number;
  /** Cap on consecutive identical lead notes. */
  maxNoteRepeat?: number;
  /** Lead range in scale degrees, `[low, high]`. Default `[0, 7]`. */
  range?: readonly [number, number];
  /** Contour amplitude in scale degrees. Default 4. */
  contourAmplitude?: number;
  /** Fix the A-section contour. Default: varied across cycles. */
  contour?: ContourShape;
  /** Include the bass layer. Default true. */
  bass?: boolean;
  /** Include the light arpeggio layer. Default true. */
  arp?: boolean;
  /** Base lead velocity, 0..1. Default 0.7. */
  velocity?: number;
}

/** A reusable rhythmic + intervallic shape (transposed on each render). */
interface Motif {
  /** Degree steps between consecutive notes (length = notes − 1). */
  readonly interiorIntervals: readonly number[];
  /** Duration of each note in grid steps (tiles the bar). */
  readonly durations: readonly number[];
}

/** AABA: motif role per bar (0 = A, 1 = B). */
const STRUCTURE: readonly number[] = [0, 0, 1, 0];
const BASS_OCTAVES_DOWN = 2;
const ARP_OCTAVES_UP = 1;
const INTERVAL_BIAS_STRENGTH = 0.35;

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** Base weight for a degree step: favour ±1/±2, allow occasional larger leaps. */
function baseIntervalWeight(delta: number): number {
  const a = Math.abs(delta);
  if (a === 0) return 2;
  if (a === 1) return 8;
  if (a === 2) return 5;
  if (a === 3) return 2;
  return 1;
}

export class MelodyStream {
  private readonly rng: Rng;
  private readonly scale: Scale;
  private readonly rootMidi: number;
  private readonly rhythm: RhythmConfig;
  private readonly maxLeap: number;
  private readonly maxNoteRepeat: number;
  private readonly rangeLo: number;
  private readonly rangeHi: number;
  private readonly home: number;
  private readonly contourAmplitude: number;
  private readonly fixedContour: ContourShape | undefined;
  private readonly bass: boolean;
  private readonly arp: boolean;
  private readonly leadVelocity: number;
  private readonly beatsPerBar: number;
  private readonly thirdDegree: number;
  private readonly fifthDegree: number;
  private readonly contourBag: ShuffleBag<ContourShape>;

  private cursorBeats = 0;
  private cyclePos = 0;
  private lastDegree: number;
  private aContour: ContourShape = "arch";
  private motifA: Motif | null = null;
  private readonly recent: number[] = [];

  constructor(options: MelodyOptions) {
    this.rng = options.rng;
    this.scale = options.scale ?? SCALES.majorPentatonic;
    this.rootMidi = options.rootMidi ?? 72;
    this.rhythm = options.rhythm ?? DEFAULT_RHYTHM;
    this.maxLeap = options.maxLeap ?? DEFAULT_MAX_LEAP;
    this.maxNoteRepeat = options.maxNoteRepeat ?? DEFAULT_MAX_NOTE_REPEAT;
    const [lo, hi] = options.range ?? [0, 7];
    this.rangeLo = lo;
    this.rangeHi = hi;
    this.contourAmplitude = options.contourAmplitude ?? 4;
    this.fixedContour = options.contour;
    this.bass = options.bass ?? true;
    this.arp = options.arp ?? true;
    this.leadVelocity = clamp(options.velocity ?? 0.7, 0, 1);

    this.home = Math.round((lo + hi) / 2);
    this.beatsPerBar = this.rhythm.beatsPerBar;
    this.lastDegree = this.clampRange(0);
    this.thirdDegree = this.findDegreeForPitchClass(4);
    this.fifthDegree = this.findDegreeForPitchClass(7);
    this.contourBag = new ShuffleBag<ContourShape>(["arch", "rising", "falling"]);

    // Validated last: the reachability and chord-tone checks need the derived
    // fields above. A config that can't satisfy the §11 invariants is rejected
    // here rather than silently degrading at generation time.
    this.validate();
  }

  /** The next bar of notes (lead, plus bass/arp if enabled), sorted by start. */
  next(): NoteEvent[] {
    const motif = this.nextMotif();
    const degrees = this.renderLead(motif);

    const events: NoteEvent[] = [];
    this.emitLead(events, degrees, motif.durations);
    if (this.bass) this.emitBass(events);
    if (this.arp) this.emitArp(events);
    events.sort((a, b) => a.startBeat - b.startBeat);

    this.cursorBeats += this.beatsPerBar;
    this.cyclePos = (this.cyclePos + 1) % STRUCTURE.length;
    return events;
  }

  // --- structure ----------------------------------------------------------

  private nextMotif(): Motif {
    const role = STRUCTURE[this.cyclePos] as number;
    if (this.cyclePos === 0) {
      this.aContour = this.fixedContour ?? this.contourBag.next(this.rng);
      this.motifA = this.makeMotif(this.aContour);
      return this.motifA;
    }
    if (role === 1) {
      const bContour: ContourShape = this.aContour === "rising" ? "falling" : "rising";
      return this.makeMotif(bContour);
    }
    return this.varyMotif(this.motifA as Motif);
  }

  private makeMotif(contour: ContourShape): Motif {
    const durations = generateBar(this.rng, this.rhythm);
    const interiorIntervals: number[] = [];
    let relative = 0; // position relative to the motif's first note
    for (let i = 1; i < durations.length; i++) {
      const target = contourTarget(contour, i, durations.length, this.contourAmplitude);
      const delta = this.pickInterval(clamp((target - relative) / this.maxLeap, -1, 1));
      interiorIntervals.push(delta);
      relative += delta;
    }
    return { interiorIntervals, durations };
  }

  /**
   * A light variation of a motif: change one interior interval. The guard makes
   * the change best-effort — if it can't find a different value it leaves the
   * motif as-is. That is safe because per-bar variety doesn't rely on this:
   * renderLead re-centres the first note and re-resolves against the live
   * lastDegree/recent state, so even an unchanged motif emits a different bar.
   */
  private varyMotif(motif: Motif): Motif {
    if (motif.interiorIntervals.length === 0) return motif;
    const intervals = [...motif.interiorIntervals];
    const idx = this.rng.int(intervals.length);
    const original = intervals[idx] as number;
    let replacement = original;
    for (let guard = 0; replacement === original && guard < 8; guard++) {
      replacement = this.pickInterval(0);
    }
    intervals[idx] = replacement;
    return { interiorIntervals: intervals, durations: motif.durations };
  }

  // --- the constrained walk ----------------------------------------------

  private renderLead(motif: Motif): number[] {
    const n = motif.durations.length;
    const degrees: number[] = [];
    let prev = this.lastDegree;
    for (let i = 0; i < n; i++) {
      const isLast = i === n - 1;
      const proposed =
        i === 0
          ? prev + this.pickInterval(clamp((this.home - prev) / this.maxLeap, -1, 1)) // re-centre
          : prev + (motif.interiorIntervals[i - 1] as number);
      let degree = this.clampRange(capLeap(prev, proposed, this.maxLeap));
      if (isLast) {
        degree = this.resolveStable(prev, degree);
      } else {
        degree = this.avoidStaleRepeat(prev, degree);
      }
      degrees.push(degree);
      this.pushRecent(degree);
      prev = degree;
    }
    this.lastDegree = prev;
    return degrees;
  }

  /** Weighted degree step: stepwise-favouring, pulled by `bias` ∈ [−1, 1]. */
  private pickInterval(bias: number): number {
    const deltas: number[] = [];
    const weights: number[] = [];
    for (let d = -this.maxLeap; d <= this.maxLeap; d++) {
      deltas.push(d);
      weights.push(baseIntervalWeight(d) * Math.max(0.05, 1 + INTERVAL_BIAS_STRENGTH * d * bias));
    }
    return this.rng.weighted(deltas, weights);
  }

  /** Nudge a candidate off a stale repeat while staying within range and the cap. */
  private avoidStaleRepeat(prev: number, candidate: number): number {
    if (!exceedsRepeatLimit(this.recent, candidate, this.maxNoteRepeat)) return candidate;
    for (const dir of candidate >= this.home ? [-1, 1] : [1, -1]) {
      const alt = this.clampRange(capLeap(prev, candidate + dir, this.maxLeap));
      if (alt !== candidate && !exceedsRepeatLimit(this.recent, alt, this.maxNoteRepeat)) {
        return alt;
      }
    }
    // Unreachable for a valid config (validate() guarantees >= 2 degrees of room);
    // defensive only.
    /* c8 ignore next */
    return candidate;
  }

  /**
   * Resolve the bar's final note onto a stable tone — nearest to where the walk
   * wanted to land, within the leap cap of the penultimate note, preferring one
   * that doesn't extend a repeat. So both invariants (stable ending AND capped
   * leap) hold together.
   */
  private resolveStable(prev: number, natural: number): number {
    let best: number | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let d = prev - this.maxLeap; d <= prev + this.maxLeap; d++) {
      const c = this.clampRange(d);
      if (!isStableDegree(this.scale, c)) continue;
      const repeats = exceedsRepeatLimit(this.recent, c, this.maxNoteRepeat) ? 1 : 0;
      const score = repeats * 1000 + Math.abs(c - natural);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    // validate() guarantees a stable degree is reachable from every position, so
    // `best` is always found for a valid config. The fallback is defensive only,
    // and stays inside the leap cap so that invariant can never break.
    /* c8 ignore next */
    return (
      best ?? this.clampRange(capLeap(prev, nearestStableDegree(this.scale, natural), this.maxLeap))
    );
  }

  // --- emit layers --------------------------------------------------------

  private emitLead(
    out: NoteEvent[],
    degrees: readonly number[],
    durations: readonly number[],
  ): void {
    let beat = this.cursorBeats;
    for (let i = 0; i < degrees.length; i++) {
      const durationBeats = stepsToBeats(durations[i] as number, this.rhythm);
      out.push({
        startBeat: beat,
        durationBeats,
        frequency: degreeToFrequency(this.scale, degrees[i] as number, this.rootMidi),
        velocity: i === 0 ? this.leadVelocity : this.leadVelocity * 0.82,
        voice: "lead",
      });
      beat += durationBeats;
    }
  }

  private emitBass(out: NoteEvent[]): void {
    const half = this.beatsPerBar / 2;
    const down = -this.scale.length * BASS_OCTAVES_DOWN;
    out.push({
      startBeat: this.cursorBeats,
      durationBeats: half,
      frequency: degreeToFrequency(this.scale, down, this.rootMidi),
      velocity: 0.5,
      voice: "bass",
    });
    out.push({
      startBeat: this.cursorBeats + half,
      durationBeats: half,
      frequency: degreeToFrequency(this.scale, this.fifthDegree + down, this.rootMidi),
      velocity: 0.45,
      voice: "bass",
    });
  }

  private emitArp(out: NoteEvent[]): void {
    if (this.cyclePos % 2 === 0) return; // light: only on alternate bars
    const up = this.scale.length * ARP_OCTAVES_UP;
    const triad = [0, this.thirdDegree, this.fifthDegree, this.scale.length];
    const start = this.cursorBeats + this.beatsPerBar - 1; // the final beat
    const each = 1 / triad.length;
    for (let i = 0; i < triad.length; i++) {
      out.push({
        startBeat: start + i * each,
        durationBeats: each,
        frequency: degreeToFrequency(this.scale, (triad[i] as number) + up, this.rootMidi),
        velocity: 0.3,
        voice: "arp",
      });
    }
  }

  // --- helpers ------------------------------------------------------------

  private clampRange(degree: number): number {
    return clamp(degree, this.rangeLo, this.rangeHi);
  }

  private pushRecent(degree: number): void {
    this.recent.push(degree);
    if (this.recent.length > this.maxNoteRepeat) this.recent.shift();
  }

  /** Degree of the first occurrence of a pitch class, or -1 if the scale lacks it. */
  private findDegreeForPitchClass(pitchClass: number): number {
    for (let d = 0; d < this.scale.length; d++) {
      if (((degreeToSemitone(this.scale, d) % 12) + 12) % 12 === pitchClass) return d;
    }
    return -1;
  }

  private validate(): void {
    if (!Number.isInteger(this.rangeLo) || !Number.isInteger(this.rangeHi)) {
      throw new RangeError("melody range bounds must be integers");
    }
    if (this.rangeHi - this.rangeLo < 1) {
      // A single-degree (or inverted) range has no room for melodic motion and
      // cannot honour the anti-repeat cap.
      throw new RangeError(
        `melody range must span at least 2 scale degrees, got [${this.rangeLo}, ${this.rangeHi}]`,
      );
    }
    if (!Number.isInteger(this.maxLeap) || this.maxLeap < 1) {
      throw new RangeError(`melody maxLeap must be an integer >= 1, got ${this.maxLeap}`);
    }
    if (!Number.isInteger(this.maxNoteRepeat) || this.maxNoteRepeat < 1) {
      throw new RangeError(
        `melody maxNoteRepeat must be an integer >= 1, got ${this.maxNoteRepeat}`,
      );
    }
    if (!(this.contourAmplitude >= 0)) {
      throw new RangeError(`melody contourAmplitude must be >= 0, got ${this.contourAmplitude}`);
    }
    // Phrase resolution must be possible from *every* reachable position: each
    // in-range degree needs a stable tone within the leap cap, in range. This is
    // exactly what makes resolveStable's main search always succeed (so both the
    // stable-ending and leap-cap invariants hold together for any seed).
    for (let degree = this.rangeLo; degree <= this.rangeHi; degree++) {
      if (!this.hasStableWithinLeap(degree)) {
        throw new RangeError(
          `melody range [${this.rangeLo}, ${this.rangeHi}] with maxLeap ${this.maxLeap} cannot ` +
            `resolve every phrase to a stable tone in the chosen scale — widen the range or scale`,
        );
      }
    }
    // The bass and arp layers need real chord tones; a scale without a perfect
    // fifth (or major third for the arp) would silently sound the root instead.
    if (this.bass && this.fifthDegree < 0) {
      throw new RangeError(
        "bass layer requires a scale containing a perfect fifth (pitch class 7)",
      );
    }
    if (this.arp && (this.thirdDegree < 0 || this.fifthDegree < 0)) {
      throw new RangeError(
        "arp layer requires a scale containing a major third and a perfect fifth",
      );
    }
  }

  /** Whether some in-range stable degree sits within the leap cap of `degree`. */
  private hasStableWithinLeap(degree: number): boolean {
    const from = Math.max(this.rangeLo, degree - this.maxLeap);
    const to = Math.min(this.rangeHi, degree + this.maxLeap);
    for (let d = from; d <= to; d++) {
      if (isStableDegree(this.scale, d)) return true;
    }
    return false;
  }
}
