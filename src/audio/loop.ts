/**
 * buildLoop — binds an arranged {@link Score} to a {@link Synth} as a sorted,
 * beat-stamped {@link PreparedLoop} the scheduler/renderer can play. Lives in the
 * audio layer because it references the synth; the {@link Session} that produces
 * the Score stays pure.
 */
import type { Score } from "../compose/arranger";
import {
  MIX_BY_VOICE,
  PAN_BY_VOICE,
  REVERB_SEND_BY_VOICE,
  type DrumVoice,
  type Instrument,
  tuneKit,
} from "../instruments";
import type { DrumName, ScoreVoice } from "../voices";
import type { PreparedLoop, ScheduledEvent } from "./scheduler";
import type { Synth } from "./synth";

/** Turn a Score + chosen instruments into a sorted, beat-stamped loop. */
export function buildLoop(
  score: Score,
  synth: Synth,
  instruments: Record<ScoreVoice, Instrument>,
  drumKit: Record<DrumName, DrumVoice>,
): PreparedLoop {
  const secondsPerBeat = 60 / score.bpm;
  const events: ScheduledEvent[] = [];
  const reverbScale = score.reverbScale ?? 1; // the section's depth in the arc — wetter when distant
  for (const part of score.parts) {
    const patch = instruments[part.voice];
    const reverbSend = Math.min(1, (patch.reverbSend ?? REVERB_SEND_BY_VOICE[part.voice]) * reverbScale);
    const mix = MIX_BY_VOICE[part.voice]; // bring the lead forward of the bed
    const pan = PAN_BY_VOICE[part.voice]; // place the voice in the stereo field
    for (const note of part.notes) {
      events.push({
        beat: note.startBeat,
        play: (time: number) =>
          synth.playNote(patch, {
            freq: note.freq,
            startTime: time,
            durationSeconds: note.durationBeats * secondsPerBeat,
            velocity: note.velocity * mix,
            reverbSend,
            pan,
            ...(note.slideFromCents !== undefined ? { slideFromCents: note.slideFromCents } : {}),
            ...(note.slideSeconds !== undefined ? { slideSeconds: note.slideSeconds } : {}),
            ...(note.shakeCents !== undefined ? { shakeCents: note.shakeCents } : {}),
            ...(note.shakeRateHz !== undefined ? { shakeRateHz: note.shakeRateHz } : {}),
            ...(note.shakeDelaySeconds !== undefined
              ? { shakeDelaySeconds: note.shakeDelaySeconds }
              : {}),
          }),
      });
    }
  }
  // The kit is authored at one fixed pitch; tune it to this piece's key so its body
  // tones sit with the harmony instead of against it.
  const kit = tuneKit(drumKit, score.rootMidi);
  for (const hit of score.drums) {
    events.push({
      beat: hit.startBeat,
      play: (time: number) => synth.playDrum(kit[hit.drum], time, hit.velocity),
    });
  }
  events.sort((a, b) => a.beat - b.beat);
  return { events, loopBeats: score.lengthBeats, secondsPerBeat };
}
