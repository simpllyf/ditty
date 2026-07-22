import { createSession, clampSafe, REVERB_SEND_BY_VOICE, MIX_BY_VOICE, PAN_BY_VOICE, tuneKit } from './chunk-QXUAM566.js';
export { DRUM_GROOVES, DRUM_KITS, INSTRUMENTS, SCALES, STREAM_EPOCH, STYLES, createSession, encodeWav, instrumentsForVoice, makeRng } from './chunk-QXUAM566.js';

// src/audio/loop.ts
function buildLoop(score, synth, instruments, drumKit) {
  const secondsPerBeat = 60 / score.bpm;
  const events = [];
  for (const part of score.parts) {
    const patch = instruments[part.voice];
    const reverbSend = patch.reverbSend ?? REVERB_SEND_BY_VOICE[part.voice];
    const mix = MIX_BY_VOICE[part.voice];
    const pan = PAN_BY_VOICE[part.voice];
    for (const note of part.notes) {
      events.push({
        beat: note.startBeat,
        play: (time) => synth.playNote(patch, {
          freq: note.freq,
          startTime: time,
          durationSeconds: note.durationBeats * secondsPerBeat,
          velocity: note.velocity * mix,
          reverbSend,
          pan,
          ...note.slideFromCents !== void 0 ? { slideFromCents: note.slideFromCents } : {},
          ...note.slideSeconds !== void 0 ? { slideSeconds: note.slideSeconds } : {},
          ...note.shakeCents !== void 0 ? { shakeCents: note.shakeCents } : {},
          ...note.shakeRateHz !== void 0 ? { shakeRateHz: note.shakeRateHz } : {},
          ...note.shakeDelaySeconds !== void 0 ? { shakeDelaySeconds: note.shakeDelaySeconds } : {}
        })
      });
    }
  }
  const kit = tuneKit(drumKit, score.rootMidi);
  for (const hit of score.drums) {
    events.push({
      beat: hit.startBeat,
      play: (time) => synth.playDrum(kit[hit.drum], time, hit.velocity)
    });
  }
  events.sort((a, b) => a.beat - b.beat);
  return { events, loopBeats: score.lengthBeats, secondsPerBeat };
}

// src/audio/scheduler.ts
var DEFAULT_LOOK_AHEAD_SECONDS = 0.1;
var DEFAULT_INTERVAL_MS = 25;
var MAX_STEPS_PER_TICK = 1e5;
var MAX_LATENESS_SECONDS = 0.25;
function defaultClock() {
  let handle = null;
  return {
    start(callback, intervalMs) {
      handle = setInterval(callback, intervalMs);
    },
    stop() {
      if (handle !== null) {
        clearInterval(handle);
        handle = null;
      }
    }
  };
}
var Scheduler = class {
  context;
  provider;
  clock;
  lookAheadSeconds;
  intervalMs;
  running = false;
  anchor = 0;
  // audio time of the current loop's beat 0
  index = 0;
  // next event in the current loop
  loop = null;
  until = null;
  // hard stop: schedule nothing at or after this time
  constructor(options) {
    this.context = options.context;
    this.provider = options.provider;
    this.clock = options.clock ?? defaultClock();
    this.lookAheadSeconds = options.lookAheadSeconds ?? DEFAULT_LOOK_AHEAD_SECONDS;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  }
  get isRunning() {
    return this.running;
  }
  /** Begin scheduling, anchored at the current audio time. Idempotent. */
  start() {
    if (this.running) return;
    const loop = this.provider();
    this.running = true;
    this.anchor = this.context.currentTime;
    this.loop = loop;
    this.index = 0;
    this.clock.start(() => this.tick(), this.intervalMs);
    this.tick();
  }
  /** Stop scheduling and reset position. Already-scheduled audio still plays out. Idempotent. */
  stop() {
    if (!this.running && !this.loop) return;
    this.running = false;
    this.clock.stop();
    this.loop = null;
    this.until = null;
  }
  /**
   * Play up to `time` and no further: events at or after it are never scheduled, and the
   * timer stops once the audio clock passes it. Lets the music be cut at a chosen musical
   * instant — a bar line — instead of wherever {@link stop} happened to land.
   * Already-scheduled audio (at most one look-ahead) still plays out.
   */
  stopAt(time) {
    if (!this.running) return;
    this.until = time;
    this.tick();
  }
  /**
   * Absolute time of the next boundary a whole number of `beats` from the current loop's
   * start — the next bar line, given a bar's beats. Null when not running, never in the past.
   */
  nextBoundary(beats) {
    if (!this.running || !this.loop || !(beats > 0)) return null;
    const span = beats * this.loop.secondsPerBeat;
    const elapsed = this.context.currentTime - this.anchor;
    return this.anchor + Math.max(1, Math.ceil(elapsed / span)) * span;
  }
  /** Pause the timer, keeping the loop so {@link resume} continues it. No-op if not running. */
  pause() {
    if (!this.running) return;
    this.running = false;
    this.clock.stop();
  }
  /**
   * Resume after {@link pause}, RE-ANCHORED to the current time. While paused the audio
   * clock may have advanced (some browsers keep the context running when hidden), so
   * replaying the same loop against a stale anchor would drop a burst of overdue events
   * — an audible glitch on the way back. Restart the loop from its head at "now" instead,
   * seamless for a background bed. No-op if never started.
   */
  resume() {
    if (this.running || !this.loop) return;
    this.anchor = this.context.currentTime;
    this.index = 0;
    this.running = true;
    this.clock.start(() => this.tick(), this.intervalMs);
    this.tick();
  }
  tick() {
    if (!this.running || !this.loop) return;
    if (this.until !== null && this.context.currentTime >= this.until) {
      this.stop();
      return;
    }
    const horizon = this.context.currentTime + this.lookAheadSeconds;
    for (let guard = 0; guard < MAX_STEPS_PER_TICK; guard++) {
      const loop = this.loop;
      if (this.index < loop.events.length) {
        const event = loop.events[this.index];
        const time = this.anchor + event.beat * loop.secondsPerBeat;
        if (time > horizon) break;
        if (this.until !== null && time >= this.until) {
          this.stop();
          return;
        }
        if (time >= this.context.currentTime - MAX_LATENESS_SECONDS) {
          event.play(Math.max(time, this.context.currentTime));
        }
        this.index++;
        continue;
      }
      const loopEnd = this.anchor + loop.loopBeats * loop.secondsPerBeat;
      if (loopEnd > horizon || loop.loopBeats <= 0) break;
      this.anchor = loopEnd;
      this.loop = this.provider();
      this.index = 0;
    }
  }
};

// src/audio/synth.ts
var clamp = clampSafe;
function softClipCurve(n = 1024) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1) * 2 - 1;
    curve[i] = Math.tanh(1.2 * x);
  }
  return curve;
}
var REVERB_DELAYS = [0.0297, 0.0419, 0.0537];
var MASTER_TONE_HZ = 6e3;
var Synth = class {
  ctx;
  master;
  tone;
  limiter;
  reverbIn;
  reverbNodes = [];
  noiseBuffer;
  live = /* @__PURE__ */ new Set();
  nyquist;
  disposed = false;
  constructor(ctx, options) {
    this.ctx = ctx;
    this.nyquist = ctx.sampleRate / 2;
    this.master = ctx.createGain();
    this.master.gain.value = clamp(options.masterGain ?? 0.35, 0, 1);
    this.tone = ctx.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.frequency.value = clamp(options.toneHz ?? MASTER_TONE_HZ, 500, this.nyquist);
    this.tone.Q.value = 0.5;
    this.limiter = ctx.createWaveShaper();
    this.limiter.curve = softClipCurve();
    this.limiter.oversample = "4x";
    this.master.connect(this.tone);
    this.tone.connect(this.limiter);
    this.limiter.connect(ctx.destination);
    this.reverbIn = this.buildReverb(options.reverb ?? {});
    this.noiseBuffer = ctx.createBuffer(1, options.noiseTable.length, ctx.sampleRate);
    this.noiseBuffer.getChannelData(0).set(options.noiseTable);
  }
  /** Set master volume, 0..1. Ramped (~20 ms) so live changes don't zipper-click. */
  setVolume(volume) {
    const g = this.master.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(this.ctx.currentTime);
    g.setTargetAtTime(clamp(volume, 0, 1), this.ctx.currentTime, 0.02);
  }
  /**
   * Linear master ramp to EXACTLY `target` over `seconds`, for a click-free pause/resume
   * edge. cancelAndHoldAtTime holds the param's true current value (no fragile `.value`
   * read, no step) before ramping; a linear ramp then actually REACHES the target — so a
   * fade-out hits true 0 before the context is suspended. (A setTargetAtTime ramp is
   * asymptotic and leaves a sliver of signal for the suspend to chop = a click.)
   */
  fade(target, seconds = 0.1) {
    const now = this.ctx.currentTime;
    const g = this.master.gain;
    if (g.cancelAndHoldAtTime) {
      g.cancelAndHoldAtTime(now);
    } else {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
    }
    g.linearRampToValueAtTime(clamp(target, 0, 1), now + Math.max(0.01, seconds));
  }
  buildReverb(opts) {
    const input = this.ctx.createGain();
    const wet = this.ctx.createGain();
    wet.gain.value = clamp(opts.mix ?? 0.9, 0, 1);
    const feedback = clamp(opts.decay ?? 0.68, 0, 0.92);
    const damping = clamp(opts.damping ?? 2600, 20, this.nyquist);
    const tapPan = [-0.6, 0, 0.6];
    REVERB_DELAYS.forEach((time, i) => {
      const delay = this.ctx.createDelay(1);
      delay.delayTime.value = time;
      const damp = this.ctx.createBiquadFilter();
      damp.type = "lowpass";
      damp.frequency.value = damping;
      const fb = this.ctx.createGain();
      fb.gain.value = feedback;
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = tapPan[i] ?? 0;
      input.connect(delay);
      delay.connect(damp);
      damp.connect(fb);
      fb.connect(delay);
      damp.connect(pan);
      pan.connect(wet);
      this.reverbNodes.push(delay, damp, fb, pan);
    });
    wet.connect(this.master);
    this.reverbNodes.push(wet);
    return input;
  }
  /** Schedule one pitched note from a patch. */
  playNote(patch, note) {
    if (this.disposed) return;
    const ctx = this.ctx;
    const { startTime: t0, durationSeconds: dur } = note;
    const { attack: a, decay: d, sustain: s, release: r } = patch.amp;
    const env = ctx.createGain();
    const peak = clamp(note.velocity * (patch.gain ?? 1), 0, 1);
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + a);
    env.gain.linearRampToValueAtTime(peak * s, t0 + a + d);
    const releaseAt = Math.max(t0 + a + d, t0 + dur);
    env.gain.setValueAtTime(peak * s, releaseAt);
    env.gain.linearRampToValueAtTime(0, releaseAt + r);
    const stopAt = releaseAt + r + 0.02;
    const nodes = [env];
    const oscs = [];
    const makeLfo = (rateHz) => {
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(clamp(rateHz, 0.01, 40), t0);
      lfo.start(t0);
      lfo.stop(stopAt);
      oscs.push(lfo);
      return lfo;
    };
    let ampIn = env;
    if (patch.tremolo) {
      const trem = ctx.createGain();
      trem.gain.setValueAtTime(1, t0);
      trem.connect(env);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(clamp(patch.tremolo.depth, 0, 1), t0);
      makeLfo(patch.tremolo.rateHz).connect(depth);
      depth.connect(trem.gain);
      nodes.push(trem, depth);
      ampIn = trem;
    }
    let shakeDepth = null;
    let shakeOffsetCents = 0;
    let shakeEaseSeconds = 0;
    if (note.shakeCents && note.shakeCents > 0 && ctx.createPeriodicWave) {
      const swing = clamp(note.shakeCents, 0, 1200);
      shakeOffsetCents = swing / 2;
      shakeEaseSeconds = Math.max(0, note.shakeDelaySeconds ?? 0);
      const depth = ctx.createGain();
      if (shakeEaseSeconds > 0) {
        depth.gain.setValueAtTime(0, t0);
        depth.gain.linearRampToValueAtTime(swing / 2, t0 + shakeEaseSeconds);
      } else {
        depth.gain.setValueAtTime(swing / 2, t0);
      }
      const lfo = makeLfo(note.shakeRateHz ?? 5);
      lfo.setPeriodicWave?.(
        ctx.createPeriodicWave(new Float32Array([0, -1]), new Float32Array([0, 0]))
      );
      lfo.connect(depth);
      nodes.push(depth);
      shakeDepth = depth;
    }
    let vibratoDepth = null;
    if (patch.vibrato) {
      const depth = ctx.createGain();
      const cents = clamp(patch.vibrato.depthCents, 0, 1200);
      const delay = Math.max(0, patch.vibrato.delaySec ?? 0);
      if (delay > 0) {
        depth.gain.setValueAtTime(0, t0);
        depth.gain.linearRampToValueAtTime(cents, t0 + delay);
      } else {
        depth.gain.setValueAtTime(cents, t0);
      }
      makeLfo(patch.vibrato.rateHz).connect(depth);
      nodes.push(depth);
      vibratoDepth = depth;
    }
    let sink = ampIn;
    if (patch.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = patch.filter.type;
      filter.Q.value = clamp(patch.filter.q ?? 1, 1e-4, 30);
      const base = clamp(patch.filter.cutoff, 20, this.nyquist);
      const amount = patch.filter.envAmount ?? 0;
      if (amount > 0) {
        filter.frequency.setValueAtTime(clamp(base + amount, 20, this.nyquist), t0);
        filter.frequency.setTargetAtTime(base, t0, Math.max(1e-3, patch.filter.envDecay ?? 0.1));
      } else {
        filter.frequency.setValueAtTime(base, t0);
      }
      filter.connect(ampIn);
      nodes.push(filter);
      sink = filter;
    }
    if (patch.formant && patch.formant.length > 0) {
      const formantIn = ctx.createGain();
      const dest = sink;
      for (const f of patch.formant) {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.setValueAtTime(clamp(f.freq, 20, this.nyquist), t0);
        bp.Q.value = clamp(f.q, 1e-4, 30);
        const g = ctx.createGain();
        g.gain.value = clamp(f.gain, 0, 1);
        formantIn.connect(bp);
        bp.connect(g);
        g.connect(dest);
        nodes.push(bp, g);
      }
      nodes.push(formantIn);
      sink = formantIn;
    }
    for (const layer of patch.layers) {
      const osc = ctx.createOscillator();
      osc.type = layer.kind;
      const detune = Math.pow(2, (layer.detuneCents ?? 0) / 1200);
      const shakeLift = Math.pow(2, shakeOffsetCents / 1200);
      const carrierBase = clamp(note.freq * (layer.ratio ?? 1) * detune, 0, this.nyquist);
      const carrierHz = clamp(carrierBase * shakeLift, 0, this.nyquist);
      if (shakeEaseSeconds > 0) {
        osc.frequency.setValueAtTime(carrierBase, t0);
        osc.frequency.linearRampToValueAtTime(carrierHz, t0 + shakeEaseSeconds);
      } else {
        osc.frequency.setValueAtTime(carrierHz, t0);
      }
      if (note.slideFromCents && note.slideSeconds) {
        osc.detune.setValueAtTime(note.slideFromCents, t0);
        osc.detune.linearRampToValueAtTime(0, t0 + note.slideSeconds);
      }
      if (shakeDepth) shakeDepth.connect(osc.detune);
      if (vibratoDepth) vibratoDepth.connect(osc.detune);
      if (layer.fm) {
        const modHz = clamp(carrierHz * layer.fm.ratio, 0, this.nyquist);
        const mod = ctx.createOscillator();
        mod.type = "sine";
        mod.frequency.setValueAtTime(modHz, t0);
        const modGain = ctx.createGain();
        const peak2 = Math.max(0, layer.fm.index) * modHz;
        modGain.gain.setValueAtTime(peak2, t0);
        if (layer.fm.decay !== void 0 && layer.fm.decay > 0) {
          modGain.gain.setTargetAtTime(0, t0, layer.fm.decay / 3);
        }
        mod.connect(modGain);
        modGain.connect(osc.frequency);
        mod.start(t0);
        mod.stop(stopAt);
        nodes.push(modGain);
        oscs.push(mod);
      }
      const layerGain = layer.gain ?? 1;
      if (layerGain !== 1) {
        const g = ctx.createGain();
        g.gain.value = clamp(layerGain, 0, 1);
        osc.connect(g);
        g.connect(sink);
        nodes.push(g);
      } else {
        osc.connect(sink);
      }
      osc.start(t0);
      osc.stop(stopAt);
      oscs.push(osc);
    }
    if (patch.noise) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      let tail = src;
      if (patch.noise.highpass !== void 0) {
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = clamp(patch.noise.highpass, 20, this.nyquist);
        tail.connect(hp);
        nodes.push(hp);
        tail = hp;
      }
      if (patch.noise.lowpass !== void 0) {
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = clamp(patch.noise.lowpass, 20, this.nyquist);
        tail.connect(lp);
        nodes.push(lp);
        tail = lp;
      }
      const ng = ctx.createGain();
      ng.gain.value = clamp(patch.noise.gain, 0, 1);
      tail.connect(ng);
      ng.connect(ampIn);
      nodes.push(ng);
      src.start(t0);
      src.stop(stopAt);
      oscs.push(src);
    }
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(note.pan ?? 0, -1, 1);
    env.connect(panner);
    panner.connect(this.master);
    nodes.push(panner);
    const send = clamp(note.reverbSend ?? patch.reverbSend ?? 0, 0, 1);
    if (send > 0) {
      const sendGain = ctx.createGain();
      sendGain.gain.value = send;
      env.connect(sendGain);
      sendGain.connect(this.reverbIn);
      nodes.push(sendGain);
    }
    this.register(nodes, oscs);
  }
  /** Schedule one drum hit, synthesized per its `kind` (data-driven, not name-switched). */
  playDrum(voice, startTime, velocity) {
    if (this.disposed) return;
    const ctx = this.ctx;
    const peak = clamp(velocity * voice.gain, 0, 1);
    const stopAt = startTime + voice.ampDecay + 0.05;
    const tc = Math.max(1e-3, voice.ampDecay / 3);
    const env = ctx.createGain();
    env.gain.setValueAtTime(peak, startTime);
    env.gain.setTargetAtTime(0, startTime, tc);
    const fadeStart = stopAt - 8e-3;
    env.gain.setValueAtTime(peak * Math.exp(-(fadeStart - startTime) / tc), fadeStart);
    env.gain.linearRampToValueAtTime(0, stopAt);
    env.connect(this.master);
    const nodes = [env];
    if (voice.kind === "tone") {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(clamp(voice.freqStart, 20, this.nyquist), startTime);
      osc.frequency.setTargetAtTime(
        clamp(voice.freqEnd, 20, this.nyquist),
        startTime,
        Math.max(1e-3, voice.pitchDecay ?? 0.03)
      );
      osc.connect(env);
      osc.start(startTime);
      osc.stop(stopAt);
      this.register(nodes, [osc]);
      return;
    }
    const oscs = [];
    {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      let tail = src;
      if (voice.highpass !== void 0) {
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = clamp(voice.highpass, 20, this.nyquist);
        src.connect(hp);
        nodes.push(hp);
        tail = hp;
      }
      const ng = ctx.createGain();
      ng.gain.value = clamp(voice.noiseGain, 0, 1);
      tail.connect(ng);
      ng.connect(env);
      nodes.push(ng);
      src.start(startTime);
      src.stop(stopAt);
      oscs.push(src);
    }
    if (voice.kind === "mixed") {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(clamp(voice.freqStart, 20, this.nyquist), startTime);
      const tg = ctx.createGain();
      tg.gain.value = clamp(voice.toneGain, 0, 1);
      osc.connect(tg);
      tg.connect(env);
      nodes.push(tg);
      osc.start(startTime);
      osc.stop(stopAt);
      oscs.push(osc);
    }
    this.register(nodes, oscs);
  }
  register(nodes, oscs) {
    const last = oscs[oscs.length - 1];
    if (!last) {
      for (const n of nodes) n.disconnect();
      return;
    }
    const entry = { nodes, oscs };
    this.live.add(entry);
    last.onended = () => {
      for (const n of nodes) n.disconnect();
      this.live.delete(entry);
    };
  }
  /** Stop all sounding notes and tear down the graph. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const now = this.ctx.currentTime;
    for (const note of this.live) {
      for (const osc of note.oscs) osc.stop(now);
      for (const n of note.nodes) n.disconnect();
    }
    this.live.clear();
    this.master.disconnect();
    this.tone.disconnect();
    this.limiter.disconnect();
    this.reverbIn.disconnect();
    for (const node of this.reverbNodes) node.disconnect();
  }
};

// src/audio/engine.ts
var clamp2 = clampSafe;
var SUSPEND_AFTER_MS = 300;
var CLOSING_RING = 0.45;
var CLOSING_TAIL_SECONDS = 0.15;
function createEngine(options = {}) {
  const session = createSession(options);
  let volume = clamp2(options.volume ?? 0.3, 0, 1);
  let graph = null;
  let disposed = false;
  let suspendTimer = null;
  const cancelPendingSuspend = () => {
    if (suspendTimer !== null) {
      clearTimeout(suspendTimer);
      suspendTimer = null;
    }
  };
  function ensureGraph() {
    if (graph) return graph;
    const context = options.audioContext ?? new AudioContext();
    const synth = new Synth(context, { noiseTable: session.noiseTable, masterGain: volume });
    let lastScore = null;
    let lastLoop = null;
    const scheduler = new Scheduler({
      context,
      provider: () => {
        const score = session.nextScore();
        if (score !== lastScore || !lastLoop) {
          lastScore = score;
          lastLoop = buildLoop(score, synth, session.instruments, session.drumKit);
        }
        return lastLoop;
      },
      ...options.clock ? { clock: options.clock } : {}
    });
    graph = { context, synth, scheduler, ownsContext: !options.audioContext };
    return graph;
  }
  let finishing = null;
  return {
    async start() {
      if (disposed) return;
      cancelPendingSuspend();
      const { context, scheduler, synth } = ensureGraph();
      await context.resume();
      if (disposed) return;
      scheduler.start();
      synth.fade(volume);
    },
    stop() {
      cancelPendingSuspend();
      finishing = null;
      graph?.scheduler.stop();
    },
    finish() {
      if (finishing) return finishing;
      if (disposed || !graph || !graph.scheduler.isRunning) {
        graph?.scheduler.stop();
        return Promise.resolve();
      }
      const g = graph;
      cancelPendingSuspend();
      const at = g.scheduler.nextBoundary(session.beatsPerBar) ?? g.context.currentTime;
      g.scheduler.stopAt(at);
      const closing = buildLoop(
        session.closingScore(),
        g.synth,
        session.instruments,
        session.drumKit
      );
      for (const event of closing.events) {
        event.play(at + event.beat * closing.secondsPerBeat);
      }
      const ringSeconds = closing.loopBeats * closing.secondsPerBeat;
      const startsIn = Math.max(0, at - g.context.currentTime);
      const fadeAfter = startsIn + ringSeconds * CLOSING_RING;
      const fadeSeconds = ringSeconds * (1 - CLOSING_RING);
      finishing = new Promise((resolve) => {
        setTimeout(() => {
          if (!disposed && graph === g) g.synth.fade(0, fadeSeconds);
          setTimeout(
            () => {
              if (!disposed && graph === g) g.scheduler.stop();
              resolve();
            },
            (fadeSeconds + CLOSING_TAIL_SECONDS) * 1e3
          );
        }, fadeAfter * 1e3);
      });
      return finishing;
    },
    pause() {
      if (disposed || !graph) return;
      cancelPendingSuspend();
      const g = graph;
      g.synth.fade(0);
      g.scheduler.pause();
      suspendTimer = setTimeout(() => {
        suspendTimer = null;
        if (!disposed && graph === g) void g.context.suspend().catch(() => {
        });
      }, SUSPEND_AFTER_MS);
    },
    resume() {
      if (disposed || !graph) return;
      cancelPendingSuspend();
      const g = graph;
      g.synth.fade(volume);
      void g.context.resume().then(() => {
        if (!disposed && graph === g) g.scheduler.resume();
      }).catch(() => {
      });
    },
    setVolume(value) {
      volume = clamp2(value, 0, 1);
      graph?.synth.setVolume(volume);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelPendingSuspend();
      graph?.scheduler.stop();
      graph?.synth.dispose();
      if (graph?.ownsContext) void graph.context.close().catch(() => {
      });
    }
  };
}

// src/audio/render.ts
var DEFAULT_SAMPLE_RATE = 44100;
var MAX_RENDER_SECONDS = 3600;
var TAIL_SECONDS = 2.5;
var defaultOfflineContext = (channels, length, sampleRate) => new OfflineAudioContext(channels, length, sampleRate);
async function renderOffline(options) {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`renderOffline sampleRate must be a positive integer, got ${sampleRate}`);
  }
  const hasSeconds = options.seconds !== void 0;
  const hasLoops = options.loops !== void 0;
  if (hasSeconds === hasLoops) {
    throw new RangeError("renderOffline requires exactly one of { seconds, loops }");
  }
  const session = createSession(options);
  const longestSectionBars = session.sections.reduce((most, s) => Math.max(most, s.bars), 0);
  const slowestSectionBpm = session.sections.reduce(
    (least, s) => Math.min(least, s.bpm),
    session.bpm
  );
  const nominalLoopSeconds = Math.max(longestSectionBars, session.bars) * session.beatsPerBar * (60 / slowestSectionBpm);
  if (!(nominalLoopSeconds > 0)) {
    throw new RangeError("renderOffline: loop length must be positive (bars/beatsPerBar > 0)");
  }
  const loopSeconds = (s) => s.lengthBeats * (60 / s.bpm);
  const scores = [];
  const offsets = [];
  let seconds;
  let cursor = 0;
  const isLoopRender = hasLoops;
  if (hasLoops) {
    const loops = options.loops;
    if (!Number.isInteger(loops) || loops <= 0) {
      throw new RangeError(`renderOffline loops must be a positive integer, got ${loops}`);
    }
    if (loops * nominalLoopSeconds > MAX_RENDER_SECONDS) {
      throw new RangeError(
        `renderOffline: ${loops} loops (~${Math.round(loops * nominalLoopSeconds)}s) exceeds the ${MAX_RENDER_SECONDS}s limit (render in chunks for longer)`
      );
    }
    for (let i = 0; i < loops; i++) {
      const score = session.nextScore();
      scores.push(score);
      offsets.push(cursor);
      cursor += loopSeconds(score);
    }
    seconds = cursor;
  } else {
    seconds = options.seconds;
    if (!(seconds > 0) || !Number.isFinite(seconds)) {
      throw new RangeError(`renderOffline seconds must be a positive number, got ${seconds}`);
    }
    const cap = Math.ceil(seconds / nominalLoopSeconds) + 4;
    for (let i = 0; i < cap && cursor < seconds; i++) {
      const score = session.nextScore();
      scores.push(score);
      offsets.push(cursor);
      cursor += loopSeconds(score);
    }
  }
  if (seconds > MAX_RENDER_SECONDS) {
    throw new RangeError(
      `renderOffline: ${seconds}s exceeds the ${MAX_RENDER_SECONDS}s limit (render in chunks for longer)`
    );
  }
  const length = Math.ceil(seconds * sampleRate);
  const renderLength = isLoopRender ? Math.ceil((seconds + TAIL_SECONDS) * sampleRate) : length;
  const ctx = (options.createContext ?? defaultOfflineContext)(2, renderLength, sampleRate);
  const synth = new Synth(ctx, {
    noiseTable: session.noiseTable,
    masterGain: options.volume ?? 0.8
  });
  for (let k = 0; k < scores.length; k++) {
    const loop = buildLoop(scores[k], synth, session.instruments, session.drumKit);
    const loopStart = offsets[k];
    for (const event of loop.events) {
      const at = loopStart + event.beat * loop.secondsPerBeat;
      if (at < seconds) event.play(at);
    }
  }
  const buffer = await ctx.startRendering();
  const finish = (full) => {
    if (!isLoopRender) return full;
    const out = full.slice(0, length);
    const overhang = full.length - length;
    for (let i = 0; i < overhang && i < length; i++) out[i] += full[length + i];
    return out;
  };
  return {
    sampleRate,
    channels: [finish(buffer.getChannelData(0)), finish(buffer.getChannelData(1))]
  };
}

export { createEngine, renderOffline };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map