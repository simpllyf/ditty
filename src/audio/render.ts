/**
 * Offline render / export — bake a generated track to audio, faster than
 * realtime, via an `OfflineAudioContext`. Reuses the same {@link Session} brain as
 * the realtime engine. Render by `seconds` (free length) or `loops` (exact loop
 * boundaries → gapless loop assets). Pair with {@link encodeWav} to write a file.
 */
import { type Session, type SessionOptions, createSession } from "../session";
import { buildLoop } from "./loop";
import { type AudioBufferLike, type AudioContextLike, Synth } from "./synth";

export { encodeWav } from "../wav";

/** An `OfflineAudioContext`-shaped context the renderer drives. */
export interface OfflineContextLike extends AudioContextLike {
  startRendering(): Promise<AudioBufferLike>;
}

/** Render length: EXACTLY one of `seconds` (free length) or `loops` (whole loops → gapless). */
export type RenderLength = { seconds: number; loops?: never } | { loops: number; seconds?: never };

interface RenderBase {
  /** Output sample rate. Default 44100. */
  sampleRate?: number;
  /** Master volume, 0..1. Default 0.8 (offline can run a touch hotter than realtime). */
  volume?: number;
  /** Inject the offline context (default: a global `OfflineAudioContext`). Enables Node tests. */
  createContext?: (channels: number, length: number, sampleRate: number) => OfflineContextLike;
}

/** Options for {@link renderOffline}: the session knobs + a length (seconds XOR loops). */
export type RenderOptions = SessionOptions & RenderBase & RenderLength;

export interface RenderResult {
  readonly sampleRate: number;
  readonly channelData: Float32Array;
}

const DEFAULT_SAMPLE_RATE = 44100;
/** Upper bound on a single render — guards against an accidental huge allocation. */
const MAX_RENDER_SECONDS = 3600;
/** Extra render time for a loop's reverb/release ring-out, wrapped onto the head. */
const TAIL_SECONDS = 2.5;

const defaultOfflineContext = (channels: number, length: number, sampleRate: number) =>
  new OfflineAudioContext(channels, length, sampleRate) as OfflineContextLike;

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
    const loops = options.loops;
    if (!Number.isInteger(loops) || loops <= 0) {
      throw new RangeError(`renderOffline loops must be a positive integer, got ${loops}`);
    }
    loopCount = loops;
    seconds = loops * secondsPerLoop;
  } else {
    seconds = options.seconds;
    if (!(seconds > 0) || !Number.isFinite(seconds)) {
      throw new RangeError(`renderOffline seconds must be a positive number, got ${seconds}`);
    }
  }

  if (seconds > MAX_RENDER_SECONDS) {
    throw new RangeError(
      `renderOffline: ${seconds}s exceeds the ${MAX_RENDER_SECONDS}s limit (render in chunks for longer)`,
    );
  }

  const length = Math.ceil(seconds * sampleRate);
  // For loop renders, render an extra tail and wrap it back onto the head so the
  // last loop's note-release and reverb don't truncate at the seam — a real gapless
  // loop. (A free-length `seconds` render is a one-shot; its tail simply ends.)
  const isLoopRender = loopCount !== null;
  const renderLength = isLoopRender ? Math.ceil((seconds + TAIL_SECONDS) * sampleRate) : length;
  const ctx = (options.createContext ?? defaultOfflineContext)(1, renderLength, sampleRate);
  const synth = new Synth(ctx, {
    noiseTable: session.noiseTable,
    masterGain: options.volume ?? 0.8,
  });

  // Only one loop-span of events is scheduled (at < seconds); the tail window holds
  // their natural ring-out, never extra notes.
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

  const rendered = (await ctx.startRendering()).getChannelData(0);
  if (!isLoopRender) return { sampleRate, channelData: rendered };
  // Overlap-add the overhang [length, renderLength) onto the head → seamless loop.
  const channelData = rendered.slice(0, length);
  const overhang = rendered.length - length;
  for (let i = 0; i < overhang && i < length; i++) channelData[i]! += rendered[length + i]!;
  return { sampleRate, channelData };
}
