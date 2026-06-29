import { describe, expect, it } from "vitest";
import { encodeWav } from "../src/wav";

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const text = (b: Uint8Array, o: number, len: number) =>
  String.fromCharCode(...Array.from(b.slice(o, o + len)));

describe("encodeWav", () => {
  it("writes a correct mono 16-bit PCM header", () => {
    const w = encodeWav([new Float32Array([0, 0.5, -0.5, 1])], 48000);
    const dv = view(w);
    expect(w.length).toBe(44 + 4 * 2);
    expect(text(w, 0, 4)).toBe("RIFF");
    expect(dv.getUint32(4, true)).toBe(36 + 8);
    expect(text(w, 8, 4)).toBe("WAVE");
    expect(text(w, 12, 4)).toBe("fmt ");
    expect(dv.getUint32(16, true)).toBe(16);
    expect(dv.getUint16(20, true)).toBe(1); // PCM
    expect(dv.getUint16(22, true)).toBe(1); // mono
    expect(dv.getUint32(24, true)).toBe(48000);
    expect(dv.getUint32(28, true)).toBe(96000); // byte rate
    expect(dv.getUint16(32, true)).toBe(2); // block align
    expect(dv.getUint16(34, true)).toBe(16);
    expect(text(w, 36, 4)).toBe("data");
    expect(dv.getUint32(40, true)).toBe(8);
  });

  it("writes a stereo header and interleaves L/R frames", () => {
    const w = encodeWav([new Float32Array([1, 0]), new Float32Array([-1, 0.5])], 44100);
    const dv = view(w);
    expect(dv.getUint16(22, true)).toBe(2); // 2 channels
    expect(dv.getUint16(32, true)).toBe(4); // block align = 2 ch × 2 bytes
    expect(dv.getUint32(28, true)).toBe(44100 * 4); // byte rate
    expect(dv.getUint32(40, true)).toBe(2 * 4); // 2 frames × blockAlign
    expect(dv.getInt16(44, true)).toBe(32767); // frame 0 L = 1
    expect(dv.getInt16(46, true)).toBe(-32767); // frame 0 R = -1
    expect(dv.getInt16(48, true)).toBe(0); // frame 1 L = 0
    expect(dv.getInt16(50, true)).toBe(Math.round(0.5 * 32767)); // frame 1 R
  });

  it("encodes samples little-endian int16, rounded + clamped + NaN→0", () => {
    const w = encodeWav([new Float32Array([0, 1, -1, 2, -2, NaN, 0.5])], 44100);
    const dv = view(w);
    expect(dv.getInt16(44, true)).toBe(0);
    expect(dv.getInt16(46, true)).toBe(32767); // 1
    expect(dv.getInt16(48, true)).toBe(-32767); // -1
    expect(dv.getInt16(50, true)).toBe(32767); // 2 clamped
    expect(dv.getInt16(52, true)).toBe(-32767); // -2 clamped
    expect(dv.getInt16(54, true)).toBe(0); // NaN → 0
    expect(dv.getInt16(56, true)).toBe(Math.round(0.5 * 32767));
  });

  it("empty input is a 44-byte header", () => {
    const w = encodeWav([new Float32Array(0)], 44100);
    expect(w.length).toBe(44);
    expect(view(w).getUint32(40, true)).toBe(0);
    expect(view(w).getUint32(4, true)).toBe(36);
  });

  it("rejects no channels and a bad sample rate", () => {
    expect(() => encodeWav([], 44100)).toThrow(RangeError);
    expect(() => encodeWav([new Float32Array(1)], 0)).toThrow(RangeError);
    expect(() => encodeWav([new Float32Array(1)], 44100.5)).toThrow(RangeError);
  });
});
