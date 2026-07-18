import { describe, expect, it } from "vitest";
import { createSession } from "../src/session";
import type { StyleName } from "../src/styles";

const STYLE_NAMES: StyleName[] = ["peppy", "calm", "playful", "dreamy"];

/**
 * Full-form integration guard: walks the entire stacked arrangement — multi-section
 * form + modulation + per-section tempo + recurring motif + bass/pad/arp roles +
 * texture gating + dynamics + fills — for many seeds × styles, and asserts every
 * emitted note and drum hit stays well-formed. Catches any edge case from combining
 * the features that a single-feature test would miss.
 */
describe("form integration — the full stacked arrangement", () => {
  it("emits valid notes/drums across every section, seed, and style", () => {
    const bad: string[] = [];
    const check = (cond: boolean, msg: string) => {
      if (!cond && bad.length < 12) bad.push(msg);
    };
    for (const style of STYLE_NAMES) {
      for (let seed = 1; seed <= 25; seed++) {
        const session = createSession({ seed, style });
        check(session.sections.length >= 4, `${style}/${seed}: form too short`);
        // The cycle opens on A; anything before loopFrom is the one-time introduction.
        check(
          session.sections[session.loopFrom]?.label === "A",
          `${style}/${seed}: cycle should open on A`,
        );
        for (let i = 0; i < session.sections.length; i++) {
          const score = session.nextScore();
          const len = score.lengthBeats;
          const where = `${style}/${seed} §${i}`;
          for (const part of score.parts) {
            for (const n of part.notes) {
              check(Number.isFinite(n.freq), `${where} ${part.voice}: non-finite freq`);
              check(
                n.freq > 20 && n.freq < 8000,
                `${where} ${part.voice}: freq ${n.freq} out of range`,
              );
              check(
                n.startBeat >= 0 && n.startBeat < len,
                `${where} ${part.voice}: startBeat ${n.startBeat} oob`,
              );
              check(
                n.startBeat + n.durationBeats <= len + 1e-6,
                `${where} ${part.voice}: note rings past loop`,
              );
              check(n.durationBeats > 0, `${where} ${part.voice}: non-positive duration`);
              check(
                n.velocity > 0 && n.velocity <= 1,
                `${where} ${part.voice}: velocity ${n.velocity} oob`,
              );
            }
          }
          for (const h of score.drums) {
            check(
              h.startBeat >= 0 && h.startBeat < len,
              `${where} drum: startBeat ${h.startBeat} oob`,
            );
            check(h.velocity > 0 && h.velocity <= 1, `${where} drum: velocity ${h.velocity} oob`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("a form genuinely develops — its sections are not all identical", () => {
    const session = createSession({ seed: 13, style: "peppy" });
    const fingerprints = session.sections.map(() => JSON.stringify(session.nextScore()));
    expect(new Set(fingerprints).size).toBeGreaterThan(1);
  });

  it("a kriti sings its parts in different registers, in one raga throughout", () => {
    // The pallavi is the reference, the anupallavi answers an octave above it, and the
    // charanam climbs past where the pallavi sits. Register is what tells a kriti's
    // parts apart — it never changes key.
    const semis = (freq: number) => 12 * Math.log2(freq / 261.6256);
    const heights = new Map<string, number[]>();
    for (const style of STYLE_NAMES) {
      for (const seed of [2, 9, 21]) {
        const session = createSession({ seed, style, form: "kriti", humanize: false });
        expect(session.formKind).toBe("kriti");
        for (const section of session.sections) {
          const score = session.nextScore();
          expect(section.keyShift).toBe(0); // one tonic, start to finish
          const lead = score.parts.find((p) => p.voice === "lead")?.notes ?? [];
          if (lead.length === 0) continue;
          const mean = lead.reduce((sum, n) => sum + semis(n.freq), 0) / lead.length;
          heights.set(section.part, [...(heights.get(section.part) ?? []), mean]);
        }
      }
    }
    const avg = (part: string) => {
      const xs = heights.get(part)!;
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(avg("anupallavi")).toBeGreaterThan(avg("pallavi") + 1); // audibly higher
    expect(avg("charanam")).toBeGreaterThan(avg("pallavi")); // climbs past where it began
    expect(avg("anupallavi")).toBeGreaterThan(avg("charanam")); // three distinct levels
  });

  it("the theme is transformed where it recurs, not merely repeated", () => {
    // The tell of a machine is a theme that returns note-for-note every time. Compare
    // the shape (intervals in semitones) of each section's opening statement: a
    // developing piece says it differently in the parts that develop it.
    const shapesOf = (style: StyleName, seed: number) => {
      const session = createSession({ seed, style, humanize: false, evolve: false });
      return session.sections.map((section) => {
        const score = session.nextScore();
        const lead = [...(score.parts.find((p) => p.voice === "lead")?.notes ?? [])].sort(
          (a, b) => a.startBeat - b.startBeat,
        );
        const head = lead.filter((n) => n.startBeat < 2 * score.beatsPerBar);
        const semis = head.map((n) => Math.round(12 * Math.log2(n.freq / 261.6256)));
        return {
          label: section.label,
          shape: semis
            .slice(1)
            .map((s, k) => s - semis[k]!)
            .join(),
        };
      });
    };

    for (const style of STYLE_NAMES) {
      for (const seed of [5, 13, 42]) {
        const heads = shapesOf(style, seed);
        const developed = heads.filter((h) => h.label !== "A");
        if (developed.length === 0) continue; // an all-A form has nothing to develop
        const homeShape = heads.find((h) => h.label === "A")!.shape;
        for (const part of developed) {
          expect(part.shape).not.toBe(homeShape); // B/C restate the theme transformed
        }
      }
    }
  });
});
