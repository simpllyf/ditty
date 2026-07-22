/**
 * Humanize — nudge a finished {@link Score}'s timing and dynamics off the grid so it
 * breathes like a player rather than a sequencer. Pure & deterministic: same rng →
 * same nudges. Applied AFTER arranging (the arranger stays exactly on the grid), so
 * toggling it never reshuffles the composition.
 */
import type { Rng } from "../rng";
import type { Score } from "./arranger";

export interface HumanizeOptions {
  /** Max timing nudge in beats (±). Default 0.02 (~10 ms at 120 bpm). */
  timing?: number;
  /** Max velocity nudge as a fraction of the note's velocity (±). Default 0.06. */
  velocity?: number;
}

const DEFAULT_TIMING = 0.02;
const DEFAULT_VELOCITY = 0.06;

/** Apply subtle, bounded, seeded timing + velocity nudges; notes stay in-bounds. */
export function humanize(score: Score, rng: Rng, options: HumanizeOptions = {}): Score {
  const maxTiming = options.timing ?? DEFAULT_TIMING;
  const maxVelocity = options.velocity ?? DEFAULT_VELOCITY;
  const nudge = (max: number) => (rng.next() * 2 - 1) * max; // uniform in [-max, max]
  const len = score.lengthBeats;

  // Shift a start while keeping it inside the loop; shorten the note so it never
  // rings past the loop point (preserving the gapless seam).
  const shift = (startBeat: number, durationBeats: number) => {
    const start = Math.min(len - 1e-6, Math.max(0, startBeat + nudge(maxTiming)));
    return { startBeat: start, durationBeats: Math.min(durationBeats, len - start) };
  };
  const swingVelocity = (velocity: number) =>
    Math.min(1, Math.max(0.01, velocity * (1 + nudge(maxVelocity))));

  const parts = score.parts.map((part) => ({
    voice: part.voice,
    notes: part.notes.map((n) => ({
      // Keep every field (freq and the slide/shake gamaka) and nudge only what humanizes:
      // timing and velocity. Rebuilding the note from scratch would silently drop ornaments.
      ...n,
      ...shift(n.startBeat, n.durationBeats),
      velocity: swingVelocity(n.velocity),
    })),
  }));
  const drums = score.drums.map((h) => ({
    startBeat: Math.min(len - 1e-6, Math.max(0, h.startBeat + nudge(maxTiming))),
    drum: h.drum,
    velocity: swingVelocity(h.velocity),
  }));
  return { ...score, parts, drums };
}
