import { describe, expect, it } from "vitest";
import { type ArpRole } from "../src/compose/arranger";
import { type FormKind } from "../src/compose/form";
import { type SessionOptions, createSession } from "../src/session";
import { type StyleName } from "../src/styles";

/**
 * The knobs compose, and they must compose EVERYWHERE. Each feature has its own
 * focused tests; this guards the cross-product, which is where the interactions
 * that no single-feature test can see actually live — an arp role that silences a
 * voice, a form that only holds together at one section length, a groove that
 * pushes a note past the loop.
 *
 * It also asserts the musical properties, not just the well-formed ones: a lead is
 * one voice and cannot sound over itself, a pad connects its chords, a voice with
 * its own figure keeps a pulse. Correctness invariants pass happily while the music
 * falls apart, so those are the ones worth spending the matrix on.
 */

const STYLES: StyleName[] = ["peppy", "calm", "playful", "dreamy", "lofi", "cinematic", "ambient"];
const FORMS: (FormKind | undefined)[] = [undefined, "song", "kriti"];
const ARP_ROLES: (ArpRole | undefined)[] = [undefined, "arp", "double", "harmony", "counter"];
const ARCHETYPES: SessionOptions["voices"][] = [
  undefined,
  { drums: false },
  { pad: false, arp: false },
  { lead: false, drums: false }, // no theme to double or harmonise
  { lead: false, pad: false },
];

const midiOf = (freq: number) => 69 + 12 * Math.log2(freq / 440);

/** Every invariant that must hold for one session, whatever knobs produced it. */
function check(options: SessionOptions, label: string, bad: string[]) {
  const fail = (msg: string) => {
    if (bad.length < 10) bad.push(`${label}: ${msg}`);
  };
  const session = createSession(options);

  for (let i = 0; i < session.sections.length; i++) {
    const score = session.nextScore();
    const section = session.sections[i]!;
    const where = `§${i}(${section.part})`;
    const len = score.lengthBeats;

    for (const part of score.parts) {
      for (const n of part.notes) {
        if (!Number.isFinite(n.freq) || n.freq <= 20 || n.freq >= 8000)
          fail(`${where} ${part.voice} freq ${n.freq}`);
        if (!(n.durationBeats > 0)) fail(`${where} ${part.voice} non-positive duration`);
        if (n.startBeat < 0 || n.startBeat >= len + 1e-9)
          fail(`${where} ${part.voice} starts outside the loop`);
        if (n.startBeat + n.durationBeats > len + 1e-6)
          fail(`${where} ${part.voice} rings past the loop`);
        if (!(n.velocity > 0 && n.velocity <= 1)) fail(`${where} ${part.voice} velocity`);
      }
      // A voice the caller asked for must be heard.
      if (part.notes.length === 0) fail(`${where} ${part.voice} is enabled but silent`);
    }
    for (const h of score.drums) {
      if (h.startBeat < 0 || h.startBeat >= len + 1e-9) fail(`${where} drum outside the loop`);
    }

    const lead = [...(score.parts.find((p) => p.voice === "lead")?.notes ?? [])].sort(
      (a, b) => a.startBeat - b.startBeat,
    );
    // The lead is a single voice: it cannot sing over itself. Swing delays an offbeat
    // eighth without shortening the note before it, so allow that much and no more.
    for (let k = 1; k < lead.length; k++) {
      const overlap = lead[k - 1]!.startBeat + lead[k - 1]!.durationBeats - lead[k]!.startBeat;
      if (overlap > 0.17) fail(`${where} lead overlaps itself by ${overlap.toFixed(2)} beats`);
    }

    const bass = score.parts.find((p) => p.voice === "bass")?.notes ?? [];
    const pad = score.parts.find((p) => p.voice === "pad")?.notes ?? [];
    if (bass.length > 0 && pad.length > 0) {
      const bassTop = Math.max(...bass.map((n) => n.freq));
      const padFloor = Math.min(...pad.map((n) => n.freq));
      if (bassTop >= padFloor) fail(`${where} bass reaches into the pad`);
    }
    // The voices stack: a lead singing under its own bass inverts the arrangement and
    // muddies both. A part given a low register is the way this gets broken.
    if (bass.length > 0 && lead.length > 0) {
      const bassTop = Math.max(...bass.map((n) => n.freq));
      const leadFloor = Math.min(...lead.map((n) => n.freq));
      if (leadFloor <= bassTop) fail(`${where} lead sings under the bass`);
    }
    // Register is set in scale DEGREES, which cover different ground per raga — a
    // pentatonic's degree 14 is over two octaves up. Unchecked, that sends a lifted
    // part shrieking.
    for (const n of lead) {
      if (n.freq > 2000) fail(`${where} lead is shrill at ${n.freq.toFixed(0)}Hz`);
    }

    // The pad connects its chords rather than re-stacking them. Group by the nearest
    // bar line: humanize nudges a chord a hair early, and flooring would file those
    // notes under the previous bar and scramble the voicing.
    if (pad.length > 2) {
      const byBar = new Map<number, Set<number>>();
      for (const n of pad) {
        const bar = Math.floor((n.startBeat + 0.25) / score.beatsPerBar);
        byBar.set(bar, (byBar.get(bar) ?? new Set()).add(Math.round(midiOf(n.freq))));
      }
      const voicings = [...byBar.keys()]
        .sort((a, b) => a - b)
        .map((b) => [...byBar.get(b)!].sort((x, y) => x - y));
      let motion = 0;
      let moves = 0;
      for (let b = 1; b < voicings.length; b++) {
        // Pairing by index across a triad and a seventh chord measures nothing.
        if (voicings[b - 1]!.length !== voicings[b]!.length) continue;
        for (let v = 0; v < voicings[b]!.length; v++) {
          motion += Math.abs(voicings[b]![v]! - voicings[b - 1]![v]!);
          moves++;
        }
      }
      if (moves > 4 && motion / moves > 3)
        fail(`${where} pad lurches — ${(motion / moves).toFixed(2)} semitones per voice`);
    }

    // A voice with its OWN figure needs a recognisable pulse. "double" and "harmony"
    // deliberately mirror the melody's rhythm, which breathes, so judging them by
    // pulse would be judging the melody instead of the arrangement.
    const role = options.arpRole ?? section.arpRole;
    if (role !== "double" && role !== "harmony") {
      const arp = [...(score.parts.find((p) => p.voice === "arp")?.notes ?? [])].sort(
        (a, b) => a.startBeat - b.startBeat,
      );
      if (arp.length >= 8) {
        const gaps = new Map<number, number>();
        for (let k = 1; k < arp.length; k++) {
          const d = Math.round((arp[k]!.startBeat - arp[k - 1]!.startBeat) * 4) / 4;
          gaps.set(d, (gaps.get(d) ?? 0) + 1);
        }
        const total = [...gaps.values()].reduce((a, b) => a + b, 0);
        if (Math.max(...gaps.values()) / total < 0.3)
          fail(`${where} arp onsets are scattered — no pulse`);
      }
    }
  }

  // A kriti never leaves its raga.
  if (session.formKind === "kriti") {
    if (session.sections.some((s) => s.keyShift !== 0)) fail("kriti modulates");
    if (session.sections[0]?.part !== "pallavi") fail("kriti does not open on the pallavi");
  }
}

describe("every knob, together", () => {
  it("holds every invariant across styles x forms x arp roles", () => {
    const bad: string[] = [];
    for (const style of STYLES) {
      for (const form of FORMS) {
        for (const arpRole of ARP_ROLES) {
          for (let seed = 0; seed < 3; seed++) {
            const options: SessionOptions = { seed, style, humanize: false };
            if (form) options.form = form;
            if (arpRole) options.arpRole = arpRole;
            check(options, `${style}/${form ?? "auto"}/${arpRole ?? "auto"}/${seed}`, bad);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("holds them with voices switched off, odd meters, and every section length", () => {
    const bad: string[] = [];
    for (const voices of ARCHETYPES) {
      for (const groove of ["straight", "waltz", "sixEight", "none"] as const) {
        for (const bars of [4, 8, 12, 16]) {
          for (const arpRole of ARP_ROLES) {
            const options: SessionOptions = {
              seed: bars + groove.length,
              style: "calm",
              bars,
              groove,
            };
            if (voices) options.voices = voices;
            if (arpRole) options.arpRole = arpRole;
            check(
              options,
              `${groove}/${bars}bars/${arpRole ?? "auto"}/${JSON.stringify(voices)}`,
              bad,
            );
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("keeps a voice audible whichever role it is given (a theme-follower with no theme)", () => {
    // "double" and "harmony" follow the lead. With the lead switched off there is no
    // theme to follow, and the arp must keep its own figure rather than fall silent on
    // a voice the caller explicitly asked to hear.
    for (const arpRole of ["arp", "double", "harmony", "counter"] as const) {
      const session = createSession({
        seed: 5,
        style: "calm",
        arpRole,
        voices: { lead: false },
        humanize: false,
      });
      let notes = 0;
      for (let i = 0; i < session.sections.length; i++) {
        notes += session.nextScore().parts.find((p) => p.voice === "arp")?.notes.length ?? 0;
      }
      expect(notes).toBeGreaterThan(0);
    }
  });

  it("is deterministic for a seed, whatever the knobs", () => {
    const options: SessionOptions = {
      seed: 99,
      style: "dreamy",
      form: "kriti",
      arpRole: "counter",
      bars: 12,
      groove: "sixEight",
      voices: { drums: false },
    };
    const render = () => {
      const s = createSession(options);
      return s.sections.map(() => JSON.stringify(s.nextScore())).join("|");
    };
    expect(render()).toBe(render());
  });
});
