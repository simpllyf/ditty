import { describe, expect, it } from "vitest";
import { type RenderOptions, renderOffline } from "../src/audio/render";
import { FakeOfflineAudioContext } from "./helpers/fake-audio-context";

interface Cap {
  ctx?: FakeOfflineAudioContext;
}
const factory = (cap: Cap) => (_channels: number, length: number, sampleRate: number) => {
  const ctx = new FakeOfflineAudioContext(length, sampleRate);
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
    expect(r.channelData.length).toBe(Math.ceil(2 * 22050));
    expect(cap.ctx!.renderCount).toBe(1);
    expect(cap.ctx!.oscillators.length).toBeGreaterThan(0);
    for (const o of cap.ctx!.oscillators) {
      expect(o.startedAt!).toBeGreaterThanOrEqual(0);
      expect(o.startedAt!).toBeLessThan(2);
    }
  });

  it("renders whole loops to exact boundaries", async () => {
    const cap: Cap = {};
    const r = await renderOffline({
      seed: 1,
      loops: 2,
      bpm: 120,
      bars: 8,
      beatsPerBar: 4,
      createContext: factory(cap),
    });
    const secondsPerLoop = 8 * 4 * (60 / 120); // 16 s
    expect(r.channelData.length).toBe(Math.ceil(2 * secondsPerLoop * 44100));
  });

  it("loop renders allocate a tail and wrap it onto the head (gapless seam)", async () => {
    const cap: Cap = {};
    const r = await renderOffline({
      seed: 1,
      loops: 2,
      bpm: 120,
      bars: 8,
      beatsPerBar: 4,
      createContext: factory(cap),
    });
    const loopLen = Math.ceil(2 * 16 * 44100);
    expect(r.channelData.length).toBe(loopLen); // returned at the exact loop boundary
    expect(cap.ctx!.length).toBeGreaterThan(loopLen); // but rendered longer to capture the ring-out
  });

  it("seconds renders are one-shot — no extra tail allocated", async () => {
    const cap: Cap = {};
    const r = await renderOffline({ seed: 1, seconds: 2, createContext: factory(cap) });
    expect(cap.ctx!.length).toBe(r.channelData.length);
  });

  it("evolves each loop by default but repeats identically with evolve:false", async () => {
    const loopFreqs = async (evolve: boolean) => {
      const cap: Cap = {};
      await renderOffline({
        seed: 5,
        loops: 2,
        bpm: 120,
        bars: 8,
        beatsPerBar: 4,
        evolve,
        createContext: factory(cap),
      });
      const secondsPerLoop = 16;
      const osc = cap.ctx!.oscillators;
      return {
        loop1: osc.filter((o) => o.startedAt! < secondsPerLoop).map((o) => o.frequency.value),
        loop2: osc.filter((o) => o.startedAt! >= secondsPerLoop).map((o) => o.frequency.value),
      };
    };
    const evolving = await loopFreqs(true);
    expect(evolving.loop2).not.toEqual(evolving.loop1); // re-arranged each loop
    const repeating = await loopFreqs(false);
    expect(repeating.loop2).toEqual(repeating.loop1); // gapless identical loop asset
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

  it("rejects a degenerate loop length (bars: 0)", async () => {
    await expect(
      renderOffline({ seconds: 1, bars: 0, createContext: factory({}) }),
    ).rejects.toThrow(RangeError);
  });
});
