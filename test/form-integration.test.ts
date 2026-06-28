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
        check(session.sections[0]?.label === "A", `${style}/${seed}: form should open on A`);
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
});
