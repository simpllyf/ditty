import { describe, expect, it } from "vitest";
import * as core from "../src/core";
import * as index from "../src/index";
import type { SectionView } from "../src/index";

describe("public exports", () => {
  // The engine entry is a CURATED, lean slice of the pure layer, so it is
  // intentionally NOT a full superset of /core. These guard the documented
  // headline API on each entry against accidental removal/drift.
  it("the engine entry exposes the engine shell + the config knobs", () => {
    for (const key of [
      "createEngine",
      "renderOffline",
      "encodeWav",
      "createSession",
      "STREAM_EPOCH",
      "SCALES",
      "STYLES",
      "INSTRUMENTS",
      "DRUM_KITS",
      "makeRng",
    ] as const) {
      expect(index, `index is missing "${key}"`).toHaveProperty(key);
    }
    // The low-level composer is a pure-layer concern — kept out of the lean engine entry.
    expect(index).not.toHaveProperty("arrange");
  });

  it("the pure entry (/core) exposes the brain but NOT the audio shell", () => {
    for (const key of [
      "createSession",
      "STREAM_EPOCH",
      "arrange",
      "generateHarmony",
      "SCALES",
      "encodeWav",
    ]) {
      expect(core, `core is missing "${key}"`).toHaveProperty(key);
    }
    // The audio engine must never leak into the pure entry.
    expect(core).not.toHaveProperty("createEngine");
    expect(core).not.toHaveProperty("renderOffline");
  });

  it("STREAM_EPOCH is a positive integer the two entries agree on", () => {
    expect(Number.isInteger(index.STREAM_EPOCH)).toBe(true);
    expect(index.STREAM_EPOCH).toBeGreaterThan(0);
    expect(core.STREAM_EPOCH).toBe(index.STREAM_EPOCH);
  });

  it("exposes SectionView (what Session.sections yields) from the engine entry", () => {
    // Type-only guard: this fails to compile if SectionView is dropped from `/index`.
    const view: SectionView = {
      label: "A",
      keyShift: 0,
      arpRole: "arp",
      development: { transform: "statement", step: 0 },
      part: "A",
    };
    expect(view.label).toBe("A");
  });
});
