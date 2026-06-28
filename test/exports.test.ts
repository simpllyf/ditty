import { describe, expect, it } from "vitest";
import * as core from "../src/core";
import * as index from "../src/index";

describe("public exports", () => {
  // The engine entry is a CURATED slice of the pure layer (kept lean for the size
  // budget), so it is intentionally NOT a full superset of /core. These guard the
  // documented headline API on each entry against accidental removal/drift.
  it("the engine entry exposes the engine shell + the config knobs", () => {
    for (const key of [
      "createEngine",
      "renderOffline",
      "encodeWav",
      "createSession",
      "arrange",
      "SCALES",
      "STYLES",
      "INSTRUMENTS",
      "DRUM_KITS",
      "makeRng",
    ] as const) {
      expect(index, `index is missing "${key}"`).toHaveProperty(key);
    }
  });

  it("the pure entry (/core) exposes the brain but NOT the audio shell", () => {
    for (const key of ["createSession", "arrange", "generateHarmony", "SCALES", "encodeWav"]) {
      expect(core, `core is missing "${key}"`).toHaveProperty(key);
    }
    // The audio engine must never leak into the pure entry.
    expect(core).not.toHaveProperty("createEngine");
    expect(core).not.toHaveProperty("renderOffline");
  });
});
