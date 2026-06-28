/**
 * Offline render / export — bake a generated track to audio, faster than
 * realtime, via an `OfflineAudioContext`. Reuses the same {@link Session} brain as
 * the realtime engine. Render by `seconds` (free length) or `loops` (exact loop
 * boundaries → gapless loop assets). Pair with {@link encodeWav} to write a file.
 */
import { type Session, type SessionOptions, buildLoop, createSession } from "./session";
import { type AudioBufferLike, type AudioContextLike, Synth } from "./synth";

export { encodeWav } from "./wav";

/** An `OfflineAudioContext`-shaped context the renderer drives. */
export interface OfflineContextLike extends AudioContextLike {
  startRendering(): Promise<AudioBufferLike>;
}

export interface RenderOptions extends SessionOptions {
  /** Render this many seconds. Provide exactly one of `seconds` or `loops`. */
  seconds?: number;
  /** Render this many whole loops (exact loop boundaries → gapless). */
  loops?: number;
  /** Output sample rate. Default 44100. */
  sampleRate?: number;
  /** Master volume, 0..1. Default 0.8 (offline can run a touch hotter than realtime). */
  volume?: number;
  /** Inject the offline context (default: a global `OfflineAudioContext`). Enables Node tests. */
  createContext?: (channels: number, length: number, sampleRate: number) => OfflineContextLike;
}

export interface RenderResult {
  readonly sampleRate: number;
  readonly channelData: Float32Array;
}

const DEFAULT_SAMPLE_RATE = 44100;

const defaultOfflineContext = (channels: number, length: number, sampleRate: number) =>
  new OfflineAudioContext(channels, length, sampleRate) as unknown as OfflineContextLike;

/** Render a generated track offline to a mono Float32 buffer. */
export async function renderOffline(options: RenderOptions): Promise<RenderResult> {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`renderOffline sampleRate must be a positive integer, got ${sampleRate}`);
  }
  const hasSeconds = options.seconds !== undefined;
  const hasLoops = options.loops !== undefined;
  if (hasSeconds === hasLoops) {
    throw new RangeError("renderOffline requires exactly one of { seconds, loops }");
  }

  const session: Session = createSession(options); // validates bpm
  const secondsPerBeat = 60 / session.bpm;
  const secondsPerLoop = session.bars * session.beatsPerBar * secondsPerBeat;
  if (!(secondsPerLoop > 0)) {
    throw new RangeError("renderOffline: loop length must be positive (bars/beatsPerBar > 0)");
  }

  let seconds: number;
  let loopCount: number | null = null;
  if (hasLoops) {
    const loops = options.loops as number;
    if (!Number.isInteger(loops) || loops <= 0) {
      throw new RangeError(`renderOffline loops must be a positive integer, got ${loops}`);
    }
    loopCount = loops;
    seconds = loops * secondsPerLoop;
  } else {
    seconds = options.seconds as number;
    if (!(seconds > 0) || !Number.isFinite(seconds)) {
      throw new RangeError(`renderOffline seconds must be a positive number, got ${seconds}`);
    }
  }

  const length = Math.ceil(seconds * sampleRate);
  const ctx = (options.createContext ?? defaultOfflineContext)(1, length, sampleRate);
  const synth = new Synth(ctx, {
    noiseTable: session.noiseTable,
    masterGain: options.volume ?? 0.8,
  });

  const schedule = (loop: ReturnType<typeof buildLoop>, loopStart: number) => {
    for (const event of loop.events) {
      const at = loopStart + event.beat * loop.secondsPerBeat;
      if (at < seconds) event.play(at);
    }
  };

  if (loopCount !== null) {
    for (let i = 0; i < loopCount; i++) {
      schedule(
        buildLoop(session.nextScore(), synth, session.instruments, session.drumKit),
        i * secondsPerLoop,
      );
    }
  } else {
    // seconds-based: bound the loop so a degenerate session can't spin.
    const cap = Math.ceil(seconds / secondsPerLoop) + 2;
    for (let i = 0; i < cap && i * secondsPerLoop < seconds; i++) {
      schedule(
        buildLoop(session.nextScore(), synth, session.instruments, session.drumKit),
        i * secondsPerLoop,
      );
    }
  }

  const buffer = await ctx.startRendering();
  return { sampleRate, channelData: buffer.getChannelData(0) };
}
