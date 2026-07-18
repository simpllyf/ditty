import { describe, expect, it } from "vitest";
import { type RenderOptions, renderOffline } from "../src/audio/render";
import { createSession } from "../src/session";
import { FakeOfflineAudioContext } from "./helpers/fake-audio-context";

/** Sum the real (per-section-tempo) durations of the first `n` loops for these opts. */
function totalLoopSeconds(opts: Record<string, unknown>, n: number): number {
  const probe = createSession(opts);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const sc = probe.nextScore();
    total += sc.lengthBeats * (60 / sc.bpm);
  }
  return total;
}

interface Cap {
  ctx?: FakeOfflineAudioContext;
}
const factory = (cap: Cap) => (channels: number, length: number, sampleRate: number) => {
  const ctx = new FakeOfflineAudioContext(length, sampleRate, channels);
  cap.ctx = ctx;
  return ctx;
};

describe("renderOffline", () => {
  it("renders the requested seconds into a correctly-sized buffer", async () => {
    const cap: Cap = {};
    const r = await renderOffline({
      seed: 1,
      seconds: 2,
      sampleRate: 22050,
      createContext: factory(cap),
    });
    expect(r.sampleRate).toBe(22050);
    expect(r.channels.length).toBe(2); // stereo
    expect(r.channels[0]!.length).toBe(Math.ceil(2 * 22050));
    expect(r.channels[1]!.length).toBe(Math.ceil(2 * 22050));
    expect(cap.ctx!.renderCount).toBe(1);
    expect(cap.ctx!.oscillators.length).toBeGreaterThan(0);
    for (const o of cap.ctx!.oscillators) {
      expect(o.startedAt!).toBeGreaterThanOrEqual(0);
      expect(o.startedAt!).toBeLessThan(2);
    }
  });

  it("renders whole loops to exact boundaries (summing per-section tempos)", async () => {
    const opts = { seed: 1, bpm: 120, bars: 8, beatsPerBar: 4 };
    const cap: Cap = {};
    const r = await renderOffline({ ...opts, loops: 2, createContext: factory(cap) });
    expect(r.channels[0]!.length).toBe(Math.ceil(totalLoopSeconds(opts, 2) * 44100));
  });

  it("loop renders allocate a tail and wrap it onto the head (gapless seam)", async () => {
    const opts = { seed: 1, bpm: 120, bars: 8, beatsPerBar: 4 };
    const cap: Cap = {};
    const r = await renderOffline({ ...opts, loops: 2, createContext: factory(cap) });
    const loopLen = Math.ceil(totalLoopSeconds(opts, 2) * 44100);
    expect(r.channels[0]!.length).toBe(loopLen); // returned at the exact form boundary
    expect(cap.ctx!.length).toBeGreaterThan(loopLen); // but rendered longer to capture the ring-out
  });

  it("overlap-adds the exact ring-out samples onto the head (verified on known content)", async () => {
    // Stamp a 1/256-stepped ramp into the rendered buffer (float32-exact, in range) so we can
    // verify the wrap math AND its offset, not merely that the head changed.
    const v = (i: number) => ((i % 256) - 128) / 256;
    const cap: Cap = {};
    const fillFactory = (channels: number, length: number, sampleRate: number) => {
      const ctx = new FakeOfflineAudioContext(length, sampleRate, channels);
      ctx.onRenderFill = (data) => {
        for (let i = 0; i < data.length; i++) data[i] = v(i);
      };
      cap.ctx = ctx;
      return ctx;
    };
    const opts = { seed: 1, bpm: 120, bars: 8, beatsPerBar: 4 };
    const r = await renderOffline({ ...opts, loops: 2, createContext: fillFactory });
    const length = r.channels[0]!.length;
    const overhang = cap.ctx!.length - length;
    expect(overhang).toBeGreaterThan(0);
    for (const i of [0, 1, 137, overhang - 1]) {
      expect(r.channels[0]![i]).toBeCloseTo(v(i) + v(length + i), 5); // head += tail at +length
    }
    expect(r.channels[0]![overhang + 10]).toBeCloseTo(v(overhang + 10), 5); // past the tail: untouched
  });

  it("places voices across the stereo field (pad left, arp right)", async () => {
    const cap: Cap = {};
    // A kriti keeps its whole ensemble from the first bar; a song's arc holds the arp
    // back until its second section, which a four-second render never reaches.
    await renderOffline({ seed: 7, seconds: 4, form: "kriti", createContext: factory(cap) });
    const pans = cap.ctx!.panners.map((p) => p.pan.value);
    expect(pans).toContain(-0.3); // pad placed left
    expect(pans).toContain(0.3); // arp placed right
  });

  it("seconds renders are one-shot — no extra tail allocated", async () => {
    const cap: Cap = {};
    const r = await renderOffline({ seed: 1, seconds: 2, createContext: factory(cap) });
    expect(cap.ctx!.length).toBe(r.channels[0]!.length);
  });

  it("evolve:true keeps changing; evolve:false loops the form (periodic)", async () => {
    const opts = { seed: 5, bpm: 120, bars: 8, beatsPerBar: 4 } as const;
    const windows = 12; // ≥ 2 full forms (max template length is 6)
    // Sections carry their own tempo → variable loop lengths; bucket by actual boundaries.
    const bounds = [0];
    const probe = createSession(opts);
    for (let i = 0; i < windows; i++) {
      const sc = probe.nextScore();
      bounds.push(bounds[bounds.length - 1]! + sc.lengthBeats * (60 / sc.bpm));
    }
    const distinctLoops = async (evolve: boolean) => {
      const cap: Cap = {};
      await renderOffline({ ...opts, loops: windows, evolve, createContext: factory(cap) });
      const osc = cap.ctx!.oscillators;
      const fps = new Set<string>();
      for (let k = 0; k < windows; k++) {
        const f = osc
          .filter((o) => o.startedAt! >= bounds[k]! && o.startedAt! < bounds[k + 1]!)
          .map((o) => o.frequency.value);
        if (f.length) fps.add(JSON.stringify(f));
      }
      return fps.size;
    };
    const evolving = await distinctLoops(true);
    const repeating = await distinctLoops(false);
    expect(repeating).toBeLessThanOrEqual(6); // only the form's sections recur
    expect(evolving).toBeGreaterThan(repeating); // re-arranged each pass
  });

  it("plumbs volume to the master gain (default 0.8)", async () => {
    const masterGain = async (extra: Record<string, unknown>) => {
      const cap: Cap = {};
      await renderOffline({ seed: 1, seconds: 1, createContext: factory(cap), ...extra });
      return cap.ctx!.gains[0]!.gain.value; // master is the first gain created
    };
    expect(await masterGain({})).toBe(0.8);
    expect(await masterGain({ volume: 0.5 })).toBe(0.5);
  });

  it("is deterministic for a seed (scheduled pitches)", async () => {
    const freqs = async () => {
      const cap: Cap = {};
      await renderOffline({ seed: 7, seconds: 3, createContext: factory(cap) });
      return cap.ctx!.oscillators.map((o) => o.frequency.value);
    };
    expect(await freqs()).toEqual(await freqs());
  });

  it("requires exactly one of seconds / loops (runtime guard for untyped callers)", async () => {
    // The XOR is enforced at compile time; these cast past it to prove the runtime guard.
    await expect(
      renderOffline({ createContext: factory({}) } as unknown as RenderOptions),
    ).rejects.toThrow(RangeError);
    await expect(
      renderOffline({
        seconds: 1,
        loops: 1,
        createContext: factory({}),
      } as unknown as RenderOptions),
    ).rejects.toThrow(RangeError);
  });

  it("rejects bad seconds / loops / bpm / sampleRate", async () => {
    await expect(renderOffline({ seconds: 0, createContext: factory({}) })).rejects.toThrow(
      RangeError,
    );
    await expect(renderOffline({ loops: 0, createContext: factory({}) })).rejects.toThrow(
      RangeError,
    );
    await expect(renderOffline({ seconds: 1, bpm: 0, createContext: factory({}) })).rejects.toThrow(
      RangeError,
    );
    await expect(
      renderOffline({ seconds: 1, sampleRate: 0, createContext: factory({}) }),
    ).rejects.toThrow(RangeError);
  });

  it("rejects an absurdly long render rather than allocating it", async () => {
    await expect(renderOffline({ seconds: 100000, createContext: factory({}) })).rejects.toThrow(
      RangeError,
    );
  });

  it("rejects an absurd loops count up front, before composing a single loop", async () => {
    const cap: Cap = {};
    await expect(renderOffline({ loops: 1e7, createContext: factory(cap) })).rejects.toThrow(
      RangeError,
    );
    expect(cap.ctx).toBeUndefined(); // bailed before even allocating the context
  });

  it("rejects a degenerate loop length (bars: 0)", async () => {
    await expect(
      renderOffline({ seconds: 1, bars: 0, createContext: factory({}) }),
    ).rejects.toThrow(RangeError);
  });
});
