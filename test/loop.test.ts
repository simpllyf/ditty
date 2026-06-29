import { describe, expect, it } from "vitest";
import type { Score } from "../src/compose/arranger";
import { buildLoop } from "../src/audio/loop";
import type { Synth } from "../src/audio/synth";
import {
  DRUM_KITS,
  type Instrument,
  MIX_BY_VOICE,
  PAN_BY_VOICE,
  REVERB_SEND_BY_VOICE,
} from "../src/instruments";
import type { ScoreVoice } from "../src/voices";

const patch = (extra: Partial<Instrument> = {}): Instrument => ({
  name: "x",
  voices: ["lead"],
  layers: [{ kind: "sine" }],
  amp: { attack: 0, decay: 0.1, sustain: 0.5, release: 0.1 },
  ...extra,
});

const instrumentsAll = (p: Instrument): Record<ScoreVoice, Instrument> => ({
  lead: p,
  bass: p,
  pad: p,
  arp: p,
});

const oneLeadNote: Score = {
  bpm: 120,
  beatsPerBar: 4,
  bars: 1,
  lengthBeats: 4,
  rootMidi: 60,
  parts: [{ voice: "lead", notes: [{ startBeat: 0, durationBeats: 1, freq: 440, velocity: 0.7 }] }],
  drums: [],
};

/** A synth stub that records the reverbSend buildLoop binds into each note. */
function recordingSynth(sends: Array<number | undefined>): Synth {
  return {
    playNote: (_p: Instrument, note: { reverbSend?: number }) => sends.push(note.reverbSend),
    playDrum: () => {},
  } as unknown as Synth;
}

describe("buildLoop", () => {
  it("falls back to REVERB_SEND_BY_VOICE when a patch has no reverbSend", () => {
    const sends: Array<number | undefined> = [];
    buildLoop(
      oneLeadNote,
      recordingSynth(sends),
      instrumentsAll(patch()),
      DRUM_KITS.default,
    ).events.forEach((e) => e.play(0));
    expect(sends).toEqual([REVERB_SEND_BY_VOICE.lead]);
  });

  it("uses the patch's own reverbSend when set", () => {
    const sends: Array<number | undefined> = [];
    const instruments = instrumentsAll(patch({ reverbSend: 0.9 }));
    buildLoop(oneLeadNote, recordingSynth(sends), instruments, DRUM_KITS.default).events.forEach(
      (e) => e.play(0),
    );
    expect(sends).toEqual([0.9]);
  });

  it("threads per-voice pan and mix into each note", () => {
    const captured: Array<{ pan: number | undefined; velocity: number }> = [];
    const synth = {
      playNote: (_p: Instrument, note: { pan?: number; velocity: number }) =>
        captured.push({ pan: note.pan, velocity: note.velocity }),
      playDrum: () => {},
    } as unknown as Synth;
    const score: Score = {
      ...oneLeadNote,
      parts: [
        { voice: "pad", notes: [{ startBeat: 0, durationBeats: 1, freq: 220, velocity: 0.5 }] },
        { voice: "arp", notes: [{ startBeat: 0, durationBeats: 1, freq: 880, velocity: 0.5 }] },
      ],
    };
    buildLoop(score, synth, instrumentsAll(patch()), DRUM_KITS.default).events.forEach((e) =>
      e.play(0),
    );
    const pad = captured.find((c) => c.pan === PAN_BY_VOICE.pad)!;
    const arp = captured.find((c) => c.pan === PAN_BY_VOICE.arp)!;
    expect(pad.velocity).toBeCloseTo(0.5 * MIX_BY_VOICE.pad, 6);
    expect(arp.velocity).toBeCloseTo(0.5 * MIX_BY_VOICE.arp, 6);
  });

  it("sorts events by beat", () => {
    const sends: Array<number | undefined> = [];
    const score: Score = {
      ...oneLeadNote,
      parts: [
        {
          voice: "lead",
          notes: [
            { startBeat: 2, durationBeats: 1, freq: 440, velocity: 0.7 },
            { startBeat: 0, durationBeats: 1, freq: 330, velocity: 0.7 },
          ],
        },
      ],
    };
    const loop = buildLoop(
      score,
      recordingSynth(sends),
      instrumentsAll(patch()),
      DRUM_KITS.default,
    );
    expect(loop.events.map((e) => e.beat)).toEqual([0, 2]);
    expect(loop.loopBeats).toBe(4);
  });
});
