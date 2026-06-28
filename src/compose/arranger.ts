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
import type { Rng } from "../rng";
import { DEFAULT_ROOT_MIDI, midiToFrequency, pitchClass } from "../theory/pitch";
import { DRUM_GROOVES, type DrumGrooveName, applySwing, fitGroove } from "../theory/rhythm";
import { SCALES, type Scale, degreeToFrequency } from "../theory/scales";
import { generateHarmony } from "./harmony";
import { generateMelody } from "./melody";

export type ScoreVoice = "lead" | "bass" | "pad" | "arp";
export type DrumName = "kick" | "snare" | "hat";

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
  rootMidi?: number;
  progression?: readonly number[];
  generateProgression?: boolean;
  groove?: DrumGrooveName;
  /** Per-voice toggles; each defaults to on. */
  voices?: VoiceToggles;
  density?: number;
  swing?: number;
  leadRange?: readonly [number, number];
}

const MIN_ROOT_MIDI = 36;
const MAX_ROOT_MIDI = 84;
const ARP_PATTERNS = ["up", "down", "updown"] as const;

/** Cycle order of a chord's pitch classes for an arpeggio. */
function arpSequence(pcs: readonly number[], pattern: (typeof ARP_PATTERNS)[number]): number[] {
  const asc = [...pcs].sort((a, b) => a - b);
  if (pattern === "up") return asc;
  if (pattern === "down") return asc.slice().reverse();
  return [...asc, ...asc.slice(1, -1).reverse()]; // updown, endpoints not repeated
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
  if (!(swing >= 0 && swing <= 1)) {
    throw new RangeError(`arrange swing must be within [0, 1], got ${swing}`);
  }
  if (!Number.isFinite(density)) {
    throw new RangeError(`arrange density must be a finite number, got ${density}`);
  }
  if (!Number.isInteger(rootMidi) || rootMidi < MIN_ROOT_MIDI || rootMidi > MAX_ROOT_MIDI) {
    throw new RangeError(
      `arrange rootMidi must be an integer in [${MIN_ROOT_MIDI}, ${MAX_ROOT_MIDI}], got ${rootMidi}`,
    );
  }
  if (!(groove in DRUM_GROOVES)) {
    throw new RangeError(`arrange groove "${groove}" is not a known DRUM_GROOVE`);
  }
  // The lead draws raga tones over chords built from the parent; they must share a
  // tuning, so the raga's pitch classes must be a subset of the parent's, or the
  // lead plays out of key.
  const parentPcs = new Set(parent.map(pitchClass));
  if (!raga.every((s) => parentPcs.has(pitchClass(s)))) {
    throw new RangeError("arrange raga must be a pitch-class subset of parent (raga ⊆ parent)");
  }

  const lengthBeats = bars * beatsPerBar;
  const enabled = (v: ScoreVoice) => options.voices?.[v] ?? true;
  const drumsOn = options.voices?.drums ?? true;
  // Clamp a note so it never rings past the loop point (after swing has shifted its start).
  const fit = (start: number, dur: number) => Math.min(dur, lengthBeats - start);
  const swung = (beat: number) => applySwing(beat, swing);

  // Fork per voice in a fixed order so toggling/retuning one voice can't reshuffle another.
  const harmonyRng = rng.fork();
  const leadRng = rng.fork();
  const bassRng = rng.fork();
  const arpRng = rng.fork();

  const plan = generateHarmony({
    rng: harmonyRng,
    scale: parent,
    rootMidi,
    bars,
    beatsPerBar,
    ...(options.progression !== undefined ? { progression: options.progression } : {}),
    ...(options.generateProgression !== undefined ? { generate: options.generateProgression } : {}),
  });

  const parts: ScorePart[] = [];

  if (enabled("lead")) {
    const melody = generateMelody({ rng: leadRng, plan, scale: raga, range: leadRange, density });
    const notes = melody.map((n): ScoreNote => {
      const start = swung(n.startBeat);
      return {
        startBeat: start,
        durationBeats: fit(start, n.durationBeats),
        freq: degreeToFrequency(raga, n.degree, rootMidi),
        velocity: n.velocity,
      };
    });
    parts.push({ voice: "lead", notes });
  }

  if (enabled("bass")) {
    const notes: ScoreNote[] = [];
    const half = beatsPerBar / 2;
    for (let bar = 0; bar < bars; bar++) {
      const chord = plan.bars[bar]!.chord;
      const rootNote = rootMidi - 12 + chord.root;
      const fifthNote = rootMidi - 12 + ((chord.root + 7) % 12); // stay in the bass octave
      const barStart = bar * beatsPerBar;
      notes.push({
        startBeat: barStart,
        durationBeats: fit(barStart, half),
        freq: midiToFrequency(rootNote),
        velocity: 0.85,
      });
      const second = bassRng.next() < 0.5 ? rootNote : fifthNote;
      const midStart = barStart + half;
      notes.push({
        startBeat: midStart,
        durationBeats: fit(midStart, half),
        freq: midiToFrequency(second),
        velocity: 0.8,
      });
    }
    parts.push({ voice: "bass", notes });
  }

  if (enabled("pad")) {
    const notes: ScoreNote[] = [];
    for (let bar = 0; bar < bars; bar++) {
      const chord = plan.bars[bar]!.chord;
      const barStart = bar * beatsPerBar;
      const dur = fit(barStart, beatsPerBar);
      for (const pc of chord.pcs) {
        notes.push({
          startBeat: barStart,
          durationBeats: dur,
          freq: midiToFrequency(rootMidi + pc),
          velocity: 0.3,
        });
      }
    }
    parts.push({ voice: "pad", notes });
  }

  if (enabled("arp")) {
    const notes: ScoreNote[] = [];
    const pattern = arpRng.pick(ARP_PATTERNS);
    const stepsPerBar = beatsPerBar * 2; // eighth notes, so swing bites
    for (let bar = 0; bar < bars; bar++) {
      const seq = arpSequence(plan.bars[bar]!.chord.pcs, pattern);
      for (let s = 0; s < stepsPerBar; s++) {
        const pc = seq[s % seq.length]!;
        const start = swung(bar * beatsPerBar + s * 0.5);
        notes.push({
          startBeat: start,
          durationBeats: fit(start, 0.45),
          freq: midiToFrequency(rootMidi + 12 + pc),
          velocity: 0.45,
        });
      }
    }
    parts.push({ voice: "arp", notes });
  }

  const drums: DrumHit[] = [];
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
          drums.push({ startBeat: drum === "hat" ? swung(raw) : raw, drum, velocity });
        }
      }
    }
  }

  return { bpm, beatsPerBar, bars, lengthBeats, rootMidi, parts, drums };
}
