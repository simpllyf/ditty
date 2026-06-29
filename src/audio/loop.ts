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
  for (const part of score.parts) {
    const patch = instruments[part.voice];
    const reverbSend = patch.reverbSend ?? REVERB_SEND_BY_VOICE[part.voice];
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
          }),
      });
    }
  }
  for (const hit of score.drums) {
    events.push({
      beat: hit.startBeat,
      play: (time: number) => synth.playDrum(drumKit[hit.drum], time, hit.velocity),
    });
  }
  events.sort((a, b) => a.beat - b.beat);
  return { events, loopBeats: score.lengthBeats, secondsPerBeat };
}
