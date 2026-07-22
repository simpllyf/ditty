// src/rng.ts
var UINT32 = 4294967296;
function makeRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = state + 1831565813 | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / UINT32;
  };
  const int = (maxExclusive) => {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
      throw new RangeError(`int(maxExclusive) requires an integer >= 1, got ${maxExclusive}`);
    }
    return Math.floor(next() * maxExclusive);
  };
  const pick = (items) => {
    if (items.length === 0) {
      throw new RangeError("pick() requires a non-empty array");
    }
    return items[int(items.length)];
  };
  const weighted = (items, weights) => {
    if (items.length === 0) {
      throw new RangeError("weighted() requires a non-empty array");
    }
    if (items.length !== weights.length) {
      throw new RangeError(
        `weighted() needs items and weights of equal length (${items.length} vs ${weights.length})`
      );
    }
    let total = 0;
    for (const weight of weights) {
      if (!(weight >= 0)) {
        throw new RangeError(`weighted() requires non-negative weights, got ${weight}`);
      }
      total += weight;
    }
    if (total <= 0) {
      throw new RangeError("weighted() requires the weights to sum to a positive number");
    }
    let threshold = next() * total;
    for (let i = 0; i < items.length; i++) {
      threshold -= weights[i];
      if (threshold < 0) {
        return items[i];
      }
    }
    for (let i = items.length - 1; i >= 0; i--) {
      if (weights[i] > 0) {
        return items[i];
      }
    }
    throw new RangeError("weighted() could not select an item");
  };
  const fork = () => makeRng(next() * UINT32 >>> 0);
  return { next, int, pick, weighted, fork };
}

// src/theory/pitch.ts
var A4_MIDI = 69;
var A4_HZ = 440;
var OCTAVE = 12;
var DEFAULT_ROOT_MIDI = 60;
function pitchClass(semitone) {
  return (semitone % OCTAVE + OCTAVE) % OCTAVE;
}
function midiToFrequency(midi) {
  return A4_HZ * 2 ** ((midi - A4_MIDI) / OCTAVE);
}
function semitoneToFrequency(semitone, rootMidi = DEFAULT_ROOT_MIDI) {
  return midiToFrequency(rootMidi + semitone);
}

// src/theory/scales.ts
var SCALES = {
  // --- Western modes ---
  major: [0, 2, 4, 5, 7, 9, 11],
  // Ionian
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  // Aeolian
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  // --- pentatonic & other ---
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
  // --- bright Carnatic ragas (some alias a Western mode) ---
  mohanam: [0, 2, 4, 7, 9],
  // = major pentatonic
  hamsadhwani: [0, 2, 4, 7, 11],
  shankarabharanam: [0, 2, 4, 5, 7, 9, 11],
  // = major
  kalyani: [0, 2, 4, 6, 7, 9, 11],
  // = lydian
  kharaharapriya: [0, 2, 3, 5, 7, 9, 10],
  // = dorian
  hindolam: [0, 3, 5, 8, 10],
  shuddhaSaveri: [0, 2, 5, 7, 9],
  madhyamavati: [0, 2, 5, 7, 10],
  abhogi: [0, 2, 3, 5, 9],
  mayamalavagowla: [0, 1, 4, 5, 7, 8, 11],
  sriranjani: [0, 2, 3, 5, 9, 10],
  // ⊆ dorian — wistful, drops the fifth
  revati: [0, 1, 5, 7, 10],
  // ⊆ phrygian — serene b2 pentatonic
  charukesi: [0, 2, 4, 5, 7, 8, 10],
  // bright tonic with b6 b7 — bittersweet (a self-paired parent)
  // --- ragas defined by their PATH, not their note set (see RAGA_PATHS) ---
  // Each entry is the union of the raga's ascent and descent. Bilahari and arabhi
  // share that union with major; what tells them apart is which notes each one is
  // allowed to use going up versus coming down.
  bilahari: [0, 2, 4, 5, 7, 9, 11],
  arabhi: [0, 2, 4, 5, 7, 9, 11],
  kambhoji: [0, 2, 4, 5, 7, 9, 10],
  // ⊆ mixolydian (Harikambhoji)
  mohanakalyani: [0, 2, 4, 6, 7, 9, 11]
  // ⊆ lydian (Mechakalyani)
};
var RAGA_PATHS = {
  bilahari: { up: [0, 2, 4, 7, 9], down: [0, 2, 4, 5, 7, 9, 11] },
  arabhi: { up: [0, 2, 5, 7, 9], down: [0, 2, 4, 5, 7, 9, 11] },
  kambhoji: { up: [0, 2, 4, 5, 7, 9], down: [0, 2, 4, 5, 7, 9, 10] },
  mohanakalyani: { up: [0, 2, 4, 7, 9], down: [0, 2, 4, 6, 7, 9, 11] }
};
function degreeToSemitone(scale, degree) {
  if (scale.length === 0) {
    throw new RangeError("degreeToSemitone() requires a non-empty scale");
  }
  if (!Number.isInteger(degree)) {
    throw new RangeError(`degreeToSemitone() requires an integer degree, got ${degree}`);
  }
  const octave = Math.floor(degree / scale.length);
  const index = degree - octave * scale.length;
  return scale[index] + octave * OCTAVE;
}
function degreeToFrequency(scale, degree, rootMidi = DEFAULT_ROOT_MIDI) {
  return semitoneToFrequency(degreeToSemitone(scale, degree), rootMidi);
}
function degreePitchClass(scale, degree) {
  return pitchClass(degreeToSemitone(scale, degree));
}

// src/theory/chords.ts
var CHORD_QUALITIES = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  dominant7: [0, 4, 7, 10],
  diminished7: [0, 3, 6, 9],
  halfDiminished7: [0, 3, 6, 10]
};
function dedupe(values) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
function chordPitchClasses(rootPc, quality) {
  return CHORD_QUALITIES[quality].map((interval) => pitchClass(rootPc + interval));
}
function makeChord(rootPc, quality) {
  return { root: pitchClass(rootPc), pcs: dedupe(chordPitchClasses(rootPc, quality)) };
}
function diatonicChord(scale, degree, size = 3) {
  const offsets = size === 4 ? [0, 2, 4, 6] : [0, 2, 4];
  const pcs = dedupe(offsets.map((o) => degreePitchClass(scale, degree + o)));
  return { root: pcs[0], pcs };
}
function isChordTone(pc, chord) {
  return chord.pcs.includes(pitchClass(pc));
}
function chordQualityOf(chord) {
  const intervals = chord.pcs.map((p) => pitchClass(p - chord.root)).sort((a, b) => a - b);
  for (const name of Object.keys(CHORD_QUALITIES)) {
    const q = [...CHORD_QUALITIES[name]].map(pitchClass).sort((a, b) => a - b);
    if (q.length === intervals.length && q.every((v, i) => v === intervals[i])) {
      return name;
    }
  }
  return null;
}
var NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];
function romanNumerals(scale) {
  if (scale.length !== 7) {
    throw new RangeError(`romanNumerals() requires a 7-note scale, got length ${scale.length}`);
  }
  return scale.map((_, degree) => {
    const quality = chordQualityOf(diatonicChord(scale, degree, 3));
    const base = NUMERALS[degree];
    if (quality === "minor") return base.toLowerCase();
    if (quality === "diminished") return `${base.toLowerCase()}\xB0`;
    if (quality === "augmented") return `${base}+`;
    if (quality === null) return `${base}?`;
    return base;
  });
}

// src/theory/progressions.ts
var PROGRESSIONS = {
  axis: [0, 4, 5, 3],
  // I–V–vi–IV
  pop: [0, 5, 3, 4],
  // I–vi–IV–V
  classic: [0, 3, 4, 0],
  // I–IV–V–I
  emotional: [5, 3, 0, 4],
  // vi–IV–I–V
  doowop: [0, 5, 1, 4],
  // I–vi–ii–V
  ascending: [0, 3, 4, 5],
  // I–IV–V–vi
  pachelbel: [0, 4, 5, 2, 3, 0, 3, 4],
  // I–V–vi–iii–IV–I–IV–V
  royalRoad: [3, 4, 2, 5],
  // IV–V–iii–vi — bright, yearning (J-pop "royal road")
  jazzTurn: [0, 3, 1, 4],
  // I–IV–ii–V — a turnaround
  descending: [0, 5, 3, 1],
  // I–vi–IV–ii — a gently descending bass
  folk: [0, 4, 3, 4]
  // I–V–IV–V — a folk/rock vamp
};
var FUNCTION_OF = {
  0: "T",
  // I
  1: "S",
  // ii
  2: "T",
  // iii (tonic substitute)
  3: "S",
  // IV
  4: "D",
  // V
  5: "T",
  // vi
  6: "D"
  // vii°
};
var TRANSITIONS = {
  T: { choices: ["S", "D"], weights: [0.55, 0.45] },
  S: { choices: ["D", "T", "S"], weights: [0.65, 0.15, 0.2] },
  D: { choices: ["T", "D"], weights: [0.75, 0.25] }
};
var DEGREES_IN = {
  T: { choices: [0, 5, 2], weights: [6, 3, 1] },
  S: { choices: [3, 1], weights: [6, 4] },
  D: { choices: [4, 6], weights: [6, 2] }
};
function nextFunction(rng, from) {
  const move = TRANSITIONS[from];
  return rng.weighted(move.choices, move.weights);
}
function degreeFor(rng, fn) {
  const degree = DEGREES_IN[fn];
  return rng.weighted(degree.choices, degree.weights);
}
function functionalProgression(rng, length) {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError(`functionalProgression length must be an integer >= 1, got ${length}`);
  }
  const degrees = [0];
  let fn = "T";
  for (let i = 1; i < length; i++) {
    fn = nextFunction(rng, fn);
    degrees.push(degreeFor(rng, fn));
  }
  return degrees;
}

// src/math.ts
function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}
function clampSafe(x, lo, hi) {
  return Number.isNaN(x) ? lo : Math.max(lo, Math.min(hi, x));
}

// src/theory/rhythm.ts
var STEPS_PER_BEAT = 4;
function metricStrength(startBeat, beatsPerBar) {
  if (startBeat === 0) return 1;
  if (beatsPerBar % 2 === 0 && startBeat === beatsPerBar / 2) return 0.8;
  if (Number.isInteger(startBeat)) return 0.5;
  if (startBeat % 1 === 0.5) return 0.3;
  return 0.15;
}
var STRONG_THRESHOLD = 0.8;
var PATTERNS = [
  [4],
  // quarter
  [2, 2],
  // two eighths
  [2, 1, 1],
  // eighth + two sixteenths
  [1, 1, 2],
  // two sixteenths + eighth
  [3, 1],
  // dotted eighth + sixteenth
  [1, 1, 1, 1]
  // four sixteenths
];
var BASE_WEIGHTS = [3, 6, 3, 2, 2, 1];
var BEAT_MODES = ["active", "held", "rest"];
function melodyRhythm(rng, beatsPerBar, options = {}) {
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1) {
    throw new RangeError(`melodyRhythm beatsPerBar must be an integer >= 1, got ${beatsPerBar}`);
  }
  const density = clampSafe(options.density ?? 0.5, 0, 1);
  const tilt = (density - 0.5) * 2;
  const weights = PATTERNS.map((p, i) => BASE_WEIGHTS[i] * p.length ** tilt);
  const modeWeights = [3 + 4 * density, 2, 4 - 2 * density];
  const onsets = [];
  let step = 0;
  const sound = () => {
    for (const durSteps of rng.weighted(PATTERNS, weights)) {
      const startBeat = step / STEPS_PER_BEAT;
      onsets.push({
        startBeat,
        durationBeats: durSteps / STEPS_PER_BEAT,
        strong: metricStrength(startBeat, beatsPerBar) >= STRONG_THRESHOLD
      });
      step += durSteps;
    }
  };
  const sustain = () => {
    const last = onsets[onsets.length - 1];
    if (!last || (last.startBeat + last.durationBeats) * STEPS_PER_BEAT !== step) return false;
    onsets[onsets.length - 1] = { ...last, durationBeats: last.durationBeats + 1 };
    step += STEPS_PER_BEAT;
    return true;
  };
  const holdUntil = 1 + Math.max(1, Math.floor(beatsPerBar / 3));
  for (let beat = 0; beat < beatsPerBar; beat++) {
    if (beat === 0) {
      sound();
      continue;
    }
    let mode;
    if (options.phraseEnd) mode = beat < holdUntil ? "held" : "rest";
    else mode = rng.weighted(BEAT_MODES, modeWeights);
    if (mode === "rest") step += STEPS_PER_BEAT;
    else if (mode === "held" && sustain()) continue;
    else sound();
  }
  return onsets;
}
var EIGHTHS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
var SIXTEENTHS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75];
var DRUM_GROOVES = {
  straight: { beatsPerBar: 4, kick: [0, 2], snare: [1, 3], hat: EIGHTHS },
  fourOnFloor: { beatsPerBar: 4, kick: [0, 1, 2, 3], snare: [1, 3], hat: [0.5, 1.5, 2.5, 3.5] },
  halfTime: { beatsPerBar: 4, kick: [0], snare: [2], hat: EIGHTHS },
  soft: { beatsPerBar: 4, kick: [0, 2], snare: [], hat: [0, 1, 2, 3] },
  busy: { beatsPerBar: 4, kick: [0, 1.5, 2, 3.5], snare: [1, 3], hat: EIGHTHS },
  syncopated: { beatsPerBar: 4, kick: [0, 1.5, 2.5], snare: [1, 3], hat: EIGHTHS },
  // off-beat kick push
  breakbeat: { beatsPerBar: 4, kick: [0, 0.75, 2.5], snare: [1, 3], hat: EIGHTHS },
  // broken kick
  halfDouble: { beatsPerBar: 4, kick: [0], snare: [2], hat: SIXTEENTHS },
  // slow backbeat, double-time hats
  waltz: { beatsPerBar: 3, kick: [0], snare: [1, 2], hat: [0, 1, 2] },
  // 3/4 oom-pah-pah
  sixEight: { beatsPerBar: 6, kick: [0, 3], snare: [3], hat: [0, 1, 2, 3, 4, 5] },
  // 6/8 compound lilt
  none: { beatsPerBar: 4, kick: [], snare: [], hat: [] }
};
function fitGroove(groove, beatsPerBar) {
  const fit = (positions) => positions.filter((p) => p < beatsPerBar);
  return { beatsPerBar, kick: fit(groove.kick), snare: fit(groove.snare), hat: fit(groove.hat) };
}
var SWING_MAX = 1 / 6;
function applySwing(position, amount) {
  if (position % 1 !== 0.5) return position;
  return position + clampSafe(amount, 0, 1) * SWING_MAX;
}

// src/compose/harmony.ts
function chordAt(bar, beatInBar, beatsPerBar) {
  return bar.second && beatInBar >= Math.floor(beatsPerBar / 2) ? bar.second.chord : bar.chord;
}
var DEFAULT_BARS = 8;
var DEFAULT_BEATS_PER_BAR = 4;
var SPLIT_RATE = 0.4;
var BORROW_RATE = 0.4;
var SECONDARY_DOMINANT_RATE = 0.35;
var TONICIZABLE_DEGREES = /* @__PURE__ */ new Set([1, 3, 4, 5]);
var BORROWED_CHORDS = [
  { shift: 10, quality: "major" },
  // ♭VII
  { shift: 8, quality: "major" },
  // ♭VI
  { shift: 5, quality: "minor" }
  // iv
];
function isBrightMajor(scale) {
  const pcs = new Set(scale.map(pitchClass));
  return pcs.has(4) && pcs.has(7) && !pcs.has(1) && !pcs.has(3);
}
function generateHarmony(options) {
  const { rng } = options;
  const scale = options.scale ?? SCALES.major;
  const rootMidi = options.rootMidi ?? DEFAULT_ROOT_MIDI;
  const bars = options.bars ?? DEFAULT_BARS;
  const beatsPerBar = options.beatsPerBar ?? DEFAULT_BEATS_PER_BAR;
  if (scale.length !== 7) {
    throw new RangeError(
      `generateHarmony requires a 7-note (heptatonic) parent scale, got length ${scale.length}`
    );
  }
  if (!Number.isInteger(bars) || bars < 4) {
    throw new RangeError(`generateHarmony bars must be an integer >= 4, got ${bars}`);
  }
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1) {
    throw new RangeError(`generateHarmony beatsPerBar must be an integer >= 1, got ${beatsPerBar}`);
  }
  if (!Number.isInteger(rootMidi)) {
    throw new RangeError(`generateHarmony rootMidi must be an integer, got ${rootMidi}`);
  }
  let degrees;
  if (options.progression) {
    const base = options.progression;
    if (base.length === 0) {
      throw new RangeError("generateHarmony progression must be non-empty");
    }
    for (const d of base) {
      if (!Number.isInteger(d) || d < 0 || d > 6) {
        throw new RangeError(`generateHarmony progression degrees must be 0..6, got ${d}`);
      }
    }
    degrees = Array.from({ length: bars }, (_, i) => base[i % base.length]);
  } else if (options.generate) {
    degrees = functionalProgression(rng, bars);
  } else {
    const base = rng.pick(Object.values(PROGRESSIONS));
    degrees = Array.from({ length: bars }, (_, i) => base[i % base.length]);
  }
  const final = bars - 1;
  const half = Math.floor(bars / 2) - 1;
  degrees[final] = 0;
  degrees[half] = 4;
  const cadence = rng.pick(["authentic", "plagal", "iiV"]);
  if (cadence === "plagal") {
    degrees[final - 1] = 3;
  } else if (cadence === "iiV" && final - 2 > half) {
    degrees[final - 2] = 1;
    degrees[final - 1] = 4;
  } else {
    degrees[final - 1] = 4;
  }
  const seventhDegrees = new Set(options.sevenths ?? []);
  const chordFor = (degree, isFinalResolution) => diatonicChord(scale, degree, !isFinalResolution && seventhDegrees.has(degree) ? 4 : 3);
  const barsOut = degrees.map((degree, i) => ({
    degree,
    chord: chordFor(degree, i === final)
  }));
  const splitApproach = rng.next() < SPLIT_RATE;
  if (splitApproach && cadence !== "iiV" && beatsPerBar % 2 === 0 && final - 1 > half) {
    const approach = final - 1;
    barsOut[approach] = {
      degree: 1,
      // ii for the first half…
      chord: chordFor(1, false),
      second: { degree: 4, chord: chordFor(4, false) }
      // …V for the second
    };
  }
  if (options.borrow && isBrightMajor(scale) && rng.next() < BORROW_RATE) {
    const eligible = barsOut.map((_, i) => i).filter((i) => i !== 0 && i !== half && i !== final && i !== final - 1);
    if (eligible.length > 0) {
      const i = rng.pick(eligible);
      const borrowed = rng.pick(BORROWED_CHORDS);
      barsOut[i] = {
        degree: barsOut[i].degree,
        chord: makeChord(borrowed.shift, borrowed.quality)
      };
    }
  }
  if (options.secondaryDominants && rng.next() < SECONDARY_DOMINANT_RATE) {
    const eligible = barsOut.map((_, i) => i).filter((i) => {
      const next = barsOut[i + 1];
      return i !== 0 && i !== half && i !== final && i !== final - 1 && !barsOut[i].second && next !== void 0 && TONICIZABLE_DEGREES.has(next.degree) && next.chord.pcs.length >= 3;
    });
    if (eligible.length > 0) {
      const i = rng.pick(eligible);
      const targetRoot = barsOut[i + 1].chord.root;
      barsOut[i] = {
        degree: barsOut[i].degree,
        chord: makeChord((targetRoot + 7) % 12, "dominant7")
        // V7 of the next chord
      };
    }
  }
  return { scale, rootMidi, beatsPerBar, bars: barsOut, cadences: { half, final } };
}
function chordTonesInScale(chord, melodyScale) {
  const ragaPcs = new Set(melodyScale.map(pitchClass));
  return chord.pcs.filter((pc) => ragaPcs.has(pc));
}

// src/constraints.ts
var DEFAULT_MAX_LEAP = 4;
var DEFAULT_MAX_NOTE_REPEAT = 2;
function isWithinLeap(prevDegree, candidateDegree, maxLeap = DEFAULT_MAX_LEAP) {
  return Math.abs(candidateDegree - prevDegree) <= maxLeap;
}
function capLeap(prevDegree, candidateDegree, maxLeap = DEFAULT_MAX_LEAP) {
  const delta = candidateDegree - prevDegree;
  if (delta > maxLeap) return prevDegree + maxLeap;
  if (delta < -maxLeap) return prevDegree - maxLeap;
  return candidateDegree;
}
function contourTarget(shape, index, length, amplitude) {
  if (length <= 1) return 0;
  const t = index / (length - 1);
  if (shape === "arch") return Math.sin(Math.PI * t) * amplitude;
  if (shape === "rising") return t * amplitude;
  if (shape === "falling") return (1 - t) * amplitude;
  return 0;
}
function exceedsRepeatLimit(recent, candidate, maxRepeat = DEFAULT_MAX_NOTE_REPEAT) {
  let run = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i] === candidate) run++;
    else break;
  }
  return run + 1 > maxRepeat;
}
var ShuffleBag = class {
  items;
  order = [];
  lastIndex = null;
  constructor(items) {
    if (items.length === 0) {
      throw new RangeError("ShuffleBag requires at least one item");
    }
    this.items = [...items];
  }
  /** Draw the next item. */
  next(rng) {
    if (this.order.length === 0) {
      this.refill(rng);
    }
    const index = this.order.pop();
    this.lastIndex = index;
    return this.items[index];
  }
  refill(rng) {
    const n = this.items.length;
    const indices = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    if (n > 1 && indices[n - 1] === this.lastIndex) {
      [indices[n - 1], indices[0]] = [indices[0], indices[n - 1]];
    }
    this.order = indices;
  }
};

// src/compose/melody.ts
var DEFAULT_RANGE = [0, 7];
function onPath(pool, from, pcOf, paths) {
  if (!paths) return pool;
  const legal = pool.filter(
    (d) => d === from || (d > from ? paths.up.has(pcOf(d)) : paths.down.has(pcOf(d)))
  );
  return legal.length > 0 ? legal : pool;
}
var DEFAULT_MAX_LEAP2 = 4;
function generateMelody(options) {
  const { rng, plan } = options;
  const scale = options.scale ?? plan.scale;
  const [lo, hi] = options.range ?? DEFAULT_RANGE;
  const maxLeap = options.maxLeap ?? DEFAULT_MAX_LEAP2;
  const maxNoteRepeat = options.maxNoteRepeat ?? 2;
  const amplitude = options.contourAmplitude ?? 4;
  const contour = options.contour ?? "arch";
  const density = options.density ?? 0.5;
  const baseVelocity = clamp(options.velocity ?? 0.7, 0, 1);
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi - lo < 1) {
    throw new RangeError(`melody range must be integers spanning >= 2 degrees, got [${lo}, ${hi}]`);
  }
  if (!Number.isInteger(maxLeap) || maxLeap < 1) {
    throw new RangeError(`melody maxLeap must be an integer >= 1, got ${maxLeap}`);
  }
  if (!Number.isInteger(maxNoteRepeat) || maxNoteRepeat < 1) {
    throw new RangeError(`melody maxNoteRepeat must be an integer >= 1, got ${maxNoteRepeat}`);
  }
  if (!(amplitude >= 0)) {
    throw new RangeError(`melody contourAmplitude must be >= 0, got ${amplitude}`);
  }
  const home = Math.round((lo + hi) / 2);
  const pcOf = (degree) => degreePitchClass(scale, degree);
  const semitoneOf = (degree) => degreeToSemitone(scale, degree);
  const ragaPcs = new Set(scale.map(pitchClass));
  const paths = options.paths ? {
    up: new Set(options.paths.up.map(pitchClass)),
    down: new Set(options.paths.down.map(pitchClass))
  } : null;
  const inRange = [];
  for (let d = lo; d <= hi; d++) inRange.push(d);
  const stateNote = (written, pcs, strong, from) => {
    let pool = inRange;
    if (strong && pcs.length > 0) {
      const tones = pool.filter((d) => pcs.includes(pcOf(d)));
      if (tones.length > 0) pool = tones;
    }
    const legal = onPath(pool, from, pcOf, paths);
    return legal.reduce(
      (best, d) => Math.abs(d - written) < Math.abs(best - written) ? d : best,
      legal[0]
    );
  };
  const notes = [];
  const recent = [];
  const remember = (degree) => {
    recent.push(degree);
    if (recent.length > maxNoteRepeat) recent.shift();
  };
  const resolveTo = (pcs) => {
    const inLeap = leapWindow(prev, lo, hi, maxLeap);
    const matches = inLeap.filter((d) => pcs.includes(pcOf(d)));
    const fresh = (pool2) => pool2.filter((d) => !exceedsRepeatLimit(recent, d, maxNoteRepeat));
    const pool = [fresh(matches), matches, fresh(inLeap), inLeap].find((t) => t.length > 0) ?? inLeap;
    const legal = onPath(pool, prev, pcOf, paths);
    return legal.reduce(
      (best, d) => Math.abs(d - prev) < Math.abs(best - prev) ? d : best,
      legal[0]
    );
  };
  let prev = lo;
  let openDist = Infinity;
  for (let d = lo; d <= hi; d++) {
    if (pcOf(d) !== 0) continue;
    const dist = Math.abs(d - home);
    if (dist < openDist) {
      openDist = dist;
      prev = d;
    }
  }
  let startBar = 0;
  const motif = options.motif;
  if (motif && motif.length > 0) {
    for (const n of motif) {
      const bar = Math.min(Math.floor(n.startBeat / plan.beatsPerBar), plan.bars.length - 1);
      const inBar = n.startBeat - bar * plan.beatsPerBar;
      const chordRagaPcs = chordAt(plan.bars[bar], inBar, plan.beatsPerBar).pcs.filter(
        (pc) => ragaPcs.has(pc)
      );
      const degree = stateNote(n.degree, chordRagaPcs, n.strong, prev);
      notes.push(degree === n.degree ? n : { ...n, degree });
      remember(degree);
      prev = degree;
    }
    startBar = options.motifBars ?? 0;
  }
  for (let bar = startBar; bar < plan.bars.length; bar++) {
    const barPlan = plan.bars[bar];
    const phraseEnd = bar % 4 === 3 || bar === plan.cadences.half || bar === plan.cadences.final;
    const onsets = melodyRhythm(rng, plan.beatsPerBar, { density, phraseEnd });
    for (let i = 0; i < onsets.length; i++) {
      const onset = onsets[i];
      const isLast = i === onsets.length - 1;
      const chord = chordAt(barPlan, onset.startBeat, plan.beatsPerBar);
      const chordRagaPcs = chord.pcs.filter((pc) => ragaPcs.has(pc));
      const phraseT = (bar % 4 + onset.startBeat / plan.beatsPerBar) / 4;
      const target = clamp(
        home + Math.round(contourTarget(contour, phraseT, 2, amplitude)),
        lo,
        hi
      );
      let degree;
      if (isLast && bar === plan.cadences.final) {
        degree = resolveTo([0]);
      } else if (isLast && bar === plan.cadences.half) {
        degree = resolveTo(chordRagaPcs.length > 0 ? chordRagaPcs : chord.pcs);
      } else {
        degree = pickNote(rng, {
          prev,
          lo,
          hi,
          maxLeap,
          target,
          pcOf,
          chordPcs: onset.strong && chordRagaPcs.length > 0 ? chordRagaPcs : null,
          recent,
          maxNoteRepeat,
          paths,
          semitoneOf
        });
      }
      notes.push({
        startBeat: bar * plan.beatsPerBar + onset.startBeat,
        durationBeats: onset.durationBeats,
        degree,
        velocity: onset.strong ? baseVelocity : baseVelocity * 0.82,
        strong: onset.strong
      });
      remember(degree);
      prev = degree;
    }
  }
  return notes;
}
function leapWindow(prev, lo, hi, maxLeap) {
  const window = [];
  for (let d = Math.max(lo, prev - maxLeap); d <= Math.min(hi, prev + maxLeap); d++) {
    window.push(d);
  }
  return window;
}
function pickNote(rng, a) {
  const inLeap = leapWindow(a.prev, a.lo, a.hi, a.maxLeap);
  const chordTones = a.chordPcs ? inLeap.filter((d) => a.chordPcs.includes(a.pcOf(d))) : [];
  let candidates = chordTones.length > 0 ? chordTones : inLeap;
  candidates = [...onPath(candidates, a.prev, a.pcOf, a.paths)];
  const nonRepeat = candidates.filter((d) => !exceedsRepeatLimit(a.recent, d, a.maxNoteRepeat));
  if (nonRepeat.length > 0) candidates = nonRepeat;
  const prevSemitone = a.semitoneOf(a.prev);
  const weights = candidates.map(
    (d) => 1 / (1 + Math.abs(d - a.target)) * (1 / (1 + Math.abs(a.semitoneOf(d) - prevSemitone)))
  );
  return rng.weighted(candidates, weights);
}

// src/compose/motif.ts
var MOTIF_TRANSFORMS = [
  "statement",
  "sequence",
  "inversion",
  "augmentation",
  "fragmentation"
];
var PLAIN_STATEMENT = { transform: "statement", step: 0 };
function developMotif(motif, development, o) {
  const plain = { notes: motif, bars: o.motifBars };
  if (motif.length === 0) return plain;
  const developed = apply(motif, development, o);
  if (!developed) return plain;
  const notes = fitRange(developed.notes, o);
  return exceedsLeap(notes, o.maxLeap) ? plain : { notes, bars: developed.bars };
}
var isStrong = (startBeat, beatsPerBar) => metricStrength(startBeat % beatsPerBar, beatsPerBar) >= STRONG_THRESHOLD;
function apply(motif, { transform, step }, o) {
  switch (transform) {
    case "statement":
      return { notes: motif, bars: o.motifBars };
    case "sequence":
      return { notes: motif.map((n) => ({ ...n, degree: n.degree + step })), bars: o.motifBars };
    case "inversion": {
      const pivot = motif[0].degree;
      return {
        notes: motif.map((n) => ({ ...n, degree: 2 * pivot - n.degree })),
        bars: o.motifBars
      };
    }
    case "augmentation": {
      const bars = o.motifBars * 2;
      if (bars >= o.sectionBars) return null;
      return {
        notes: motif.map((n) => {
          const startBeat = n.startBeat * 2;
          return {
            ...n,
            startBeat,
            durationBeats: n.durationBeats * 2,
            strong: isStrong(startBeat, o.beatsPerBar)
          };
        }),
        bars
      };
    }
    case "fragmentation": {
      const head = motif.filter((n) => n.startBeat < o.beatsPerBar);
      if (head.length === 0) return null;
      const notes = [];
      for (let repeat = 0; repeat < o.motifBars; repeat++) {
        for (const n of head) {
          notes.push({
            ...n,
            startBeat: n.startBeat + repeat * o.beatsPerBar,
            // A head note may be sustained past the bar line; trim it so the next
            // repeat can start where it should instead of sounding over it.
            durationBeats: Math.min(n.durationBeats, o.beatsPerBar - n.startBeat),
            degree: n.degree + repeat * step
          });
        }
      }
      return { notes, bars: o.motifBars };
    }
  }
}
function fitRange(notes, o) {
  const [lo, hi] = o.range;
  let min = Infinity;
  let max = -Infinity;
  for (const n of notes) {
    if (n.degree < min) min = n.degree;
    if (n.degree > max) max = n.degree;
  }
  if (min >= lo && max <= hi) return notes;
  const octave = Math.max(1, o.degreesPerOctave);
  const shift = max > hi ? -Math.ceil((max - hi) / octave) * octave : Math.ceil((lo - min) / octave) * octave;
  return notes.map((n) => ({ ...n, degree: clamp(n.degree + shift, lo, hi) }));
}
function exceedsLeap(notes, maxLeap) {
  for (let i = 1; i < notes.length; i++) {
    if (Math.abs(notes[i].degree - notes[i - 1].degree) > maxLeap) return true;
  }
  return false;
}

// src/compose/arranger.ts
var MIN_ROOT_MIDI = 36;
var MAX_ROOT_MIDI = 84;
var ARP_PATTERNS = ["up", "down", "updown"];
var TEXTURE_SECTIONS = 4;
var TEXTURES = {
  full: { arp: [1, 1, 1, 1], drums: [1, 1, 1, 1] },
  build: { arp: [0, 0, 1, 1], drums: [0, 1, 1, 1] },
  breakdown: { arp: [1, 1, 0, 1], drums: [1, 1, 0, 1] },
  pulse: { arp: [0, 1, 0, 1], drums: [1, 1, 1, 1] }
};
function thirdBelow(scale, degree) {
  const lead = degreeToSemitone(scale, degree);
  let best = degree - 2;
  let bestDiff = Infinity;
  for (let d = degree - 1; d >= degree - 4; d--) {
    const interval = lead - degreeToSemitone(scale, d);
    if (interval < 3) continue;
    const diff = Math.abs(interval - 3.5);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = d;
    }
  }
  return best;
}
function arpSequence(pcs, pattern) {
  const asc = [...pcs].sort((a, b) => a - b);
  if (pattern === "up") return asc;
  if (pattern === "down") return asc.slice().reverse();
  return [...asc, ...asc.slice(1, -1).reverse()];
}
function assertMusicalParams(p) {
  if (!(p.swing >= 0 && p.swing <= 1)) {
    throw new RangeError(`swing must be within [0, 1], got ${p.swing}`);
  }
  if (!Number.isFinite(p.density)) {
    throw new RangeError(`density must be a finite number, got ${p.density}`);
  }
  if (!Number.isInteger(p.rootMidi) || p.rootMidi < MIN_ROOT_MIDI || p.rootMidi > MAX_ROOT_MIDI) {
    throw new RangeError(
      `rootMidi must be an integer in [${MIN_ROOT_MIDI}, ${MAX_ROOT_MIDI}], got ${p.rootMidi}`
    );
  }
  if (!(p.groove in DRUM_GROOVES)) {
    throw new RangeError(`groove "${p.groove}" is not a known DRUM_GROOVE`);
  }
  const parentPcs = new Set(p.parent.map(pitchClass));
  if (!p.raga.every((s) => parentPcs.has(pitchClass(s)))) {
    throw new RangeError("raga must be a pitch-class subset of parent (raga \u2286 parent)");
  }
}
var DEFAULT_BPM = 100;
var SHAKE_MIN_SECONDS = 0.6;
var SHAKE_RATE_HZ = 4.6;
var SHAKE_REACH = 0.62;
var SHAKE_MAX_CENTS = 170;
var SHAKE_EASE = 0.22;
var SLIDE_MIN_SEMITONES = 4;
var SLIDE_ARRIVAL_BEATS = 1;
var SLIDE_BASE_SECONDS = 0.05;
var SLIDE_PER_SEMITONE = 0.015;
var SLIDE_MAX_SECONDS = 0.16;
function arrangeLead(ctx) {
  const secondsPerBeat = 60 / (ctx.options.bpm ?? DEFAULT_BPM);
  const semitoneOf = (degree) => degreeToSemitone(ctx.raga, degree);
  return ctx.leadMelody.map((n, i) => {
    const start = ctx.swung(n.startBeat);
    const durationBeats = ctx.fit(start, n.durationBeats);
    const note = {
      startBeat: start,
      durationBeats,
      freq: degreeToFrequency(ctx.raga, n.degree, ctx.rootMidi),
      velocity: n.velocity
    };
    if (!ctx.options.slide) return note;
    const prev = ctx.leadMelody[i - 1];
    if (!prev || prev.startBeat + prev.durationBeats < n.startBeat - 1e-9) return note;
    const leap = semitoneOf(n.degree) - semitoneOf(prev.degree);
    if (Math.abs(leap) < SLIDE_MIN_SEMITONES) return note;
    if (!n.strong && durationBeats < SLIDE_ARRIVAL_BEATS) return note;
    const seconds = Math.min(
      SLIDE_MAX_SECONDS,
      SLIDE_BASE_SECONDS + Math.abs(leap) * SLIDE_PER_SEMITONE
    );
    if (durationBeats * secondsPerBeat < seconds * 3) return note;
    return { ...note, slideFromCents: -leap * 100, slideSeconds: seconds };
  }).map((note, i) => {
    if (!ctx.options.shake) return note;
    const held = note.durationBeats * secondsPerBeat;
    if (held < SHAKE_MIN_SECONDS) return note;
    const degree = ctx.leadMelody[i].degree;
    const pc = (semitoneOf(degree) % OCTAVE + OCTAVE) % OCTAVE;
    if (pc === 0 || pc === 7) return note;
    const toNeighbour = semitoneOf(degree + 1) - semitoneOf(degree);
    const cents = Math.min(SHAKE_MAX_CENTS, toNeighbour * 100 * SHAKE_REACH);
    if (cents < 40) return note;
    return {
      ...note,
      shakeCents: cents,
      shakeRateHz: SHAKE_RATE_HZ,
      shakeDelaySeconds: Math.min(0.25, held * SHAKE_EASE)
    };
  });
}
function arrangeBass(ctx) {
  const { plan, beatsPerBar, bars, rootMidi, fit, bassRng } = ctx;
  const notes = [];
  const bassPattern = ctx.options.bassPattern ?? "rootFifth";
  const mid = Math.floor(beatsPerBar / 2);
  const bassFloor = rootMidi - OCTAVE;
  const low = (pc) => midiToFrequency(bassFloor + pc);
  plan.scale.map((s) => (s % OCTAVE + OCTAVE) % OCTAVE);
  const approachInto = (targetPc, fromMidi) => {
    return null;
  };
  const onsets = [];
  for (let bar = 0; bar < bars; bar++) {
    const bp = plan.bars[bar];
    onsets.push({ beat: bar * beatsPerBar, root: bp.chord.root });
    if (bp.second) onsets.push({ beat: bar * beatsPerBar + mid, root: bp.second.chord.root });
  }
  const leadInto = (beat, fromRoot) => {
    const on = onsets.find((o) => o.beat > beat + 1e-9);
    return on && Math.abs(on.beat - (beat + 1)) < 1e-9 && on.root !== fromRoot ? on.root : void 0;
  };
  for (let bar = 0; bar < bars; bar++) {
    const barPlan = plan.bars[bar];
    const chord = barPlan.chord;
    const barStart = bar * beatsPerBar;
    const root = chord.root;
    const under = (beat) => {
      const c = chordAt(barPlan, beat - barStart, beatsPerBar);
      return { root: c.root, fifth: c.pcs[2] ?? c.root, pcs: c.pcs };
    };
    if (bassPattern === "rootFifth") {
      notes.push({
        startBeat: barStart,
        durationBeats: fit(barStart, mid),
        freq: low(root),
        velocity: 0.85
      });
      const midStart = barStart + mid;
      const half = under(midStart);
      const second = bassRng.next() < 0.5 ? half.root : half.fifth;
      const secondSpan = beatsPerBar - mid;
      const into = leadInto(barStart + beatsPerBar - 1, half.root);
      const step = into !== void 0 && secondSpan >= 2 ? approachInto() : null;
      if (step !== null) {
        const mainSpan = secondSpan - 1;
        notes.push({
          startBeat: midStart,
          durationBeats: fit(midStart, mainSpan),
          freq: low(second),
          velocity: 0.8
        });
        const pickStart = midStart + mainSpan;
        notes.push({
          startBeat: pickStart,
          durationBeats: fit(pickStart, 1),
          freq: midiToFrequency(step),
          velocity: 0.75
        });
      } else {
        notes.push({
          startBeat: midStart,
          durationBeats: fit(midStart, secondSpan),
          freq: low(second),
          velocity: 0.8
        });
      }
    } else if (bassPattern === "pulse") {
      for (let b = 0; b < beatsPerBar; b++) {
        const at = barStart + b;
        const here = under(at).root;
        const into = leadInto(at, here);
        const step = into !== void 0 ? approachInto() : null;
        notes.push({
          startBeat: at,
          durationBeats: fit(at, 0.9),
          freq: step !== null ? midiToFrequency(step) : low(here),
          velocity: b === 0 ? 0.85 : 0.72
        });
      }
    } else if (bassPattern === "walking") {
      bassFloor + under(barStart).root;
      for (let b = 0; b < beatsPerBar; b++) {
        const at = barStart + b;
        const here = under(at);
        const into = leadInto(at, here.root);
        const walk = bassFloor + (here.pcs[b % here.pcs.length] ?? here.root);
        let midi;
        if (b === 0) midi = bassFloor + here.root;
        else if (into !== void 0) midi = approachInto() ?? walk;
        else midi = walk;
        notes.push({
          startBeat: at,
          durationBeats: fit(at, 0.9),
          freq: midiToFrequency(midi),
          velocity: b === 0 ? 0.85 : 0.75
        });
      }
    } else {
      const spans = barPlan.second ? [
        [barStart, mid],
        [barStart + mid, beatsPerBar - mid]
      ] : [[barStart, beatsPerBar]];
      for (const [beat, span] of spans) {
        notes.push({
          startBeat: beat,
          durationBeats: fit(beat, span),
          freq: low(under(beat).root),
          velocity: 0.8
        });
      }
    }
  }
  return notes;
}
function voiceLead(pcs, prev, rootMidi, hi) {
  const centre = (rootMidi + hi) / 2;
  const voiced = pcs.map((pc) => {
    const base = rootMidi + (pc % OCTAVE + OCTAVE) % OCTAVE;
    let best = base;
    let bestNear = Infinity;
    let bestCentre = Infinity;
    for (let midi = base; midi <= hi; midi += OCTAVE) {
      const near = prev.length === 0 ? 0 : Math.min(...prev.map((p) => Math.abs(p - midi)));
      const fromCentre = Math.abs(midi - centre);
      if (near < bestNear || near === bestNear && fromCentre < bestCentre) {
        best = midi;
        bestNear = near;
        bestCentre = fromCentre;
      }
    }
    return best;
  });
  return openLowClusters(voiced, hi);
}
function openLowClusters(voicing, hi) {
  const out = [...voicing].sort((a, b) => a - b);
  for (let i = 0; i + 1 < out.length; i++) {
    const lo = out[i];
    const up = out[i + 1];
    if (up - lo === 1 && lo < 60 && up + OCTAVE <= hi) {
      out[i + 1] = up + OCTAVE;
      out.sort((a, b) => a - b);
      i = -1;
    }
  }
  return out;
}
function arrangePad(ctx) {
  const { plan, beatsPerBar, bars, rootMidi, fit } = ctx;
  const padPattern = ctx.options.padPattern ?? "sustain";
  const notes = [];
  const padHi = rootMidi + 2 * OCTAVE;
  const mid = Math.floor(beatsPerBar / 2);
  const opening = plan.bars[0].chord;
  let voicing = opening.pcs.map(
    (pc) => rootMidi + opening.root + (pc - opening.root + OCTAVE) % OCTAVE
  );
  for (let bar = 0; bar < bars; bar++) {
    const barPlan = plan.bars[bar];
    const barStart = bar * beatsPerBar;
    if (bar > 0) voicing = voiceLead(barPlan.chord.pcs, voicing, rootMidi, padHi);
    const late = barPlan.second ? voiceLead(barPlan.second.chord.pcs, voicing, rootMidi, padHi) : null;
    const at = (beat) => late && beat - barStart >= mid ? late : voicing;
    if (padPattern === "stabs") {
      for (let b = 0; b < beatsPerBar; b++) {
        const beat = barStart + b;
        for (const midi of at(beat)) {
          notes.push({
            startBeat: beat,
            durationBeats: fit(beat, 0.4),
            freq: midiToFrequency(midi),
            velocity: 0.32
          });
        }
      }
    } else if (padPattern === "broken") {
      const until = late ? [mid, beatsPerBar] : [beatsPerBar];
      let from = 0;
      for (const edge of until) {
        const voices = at(barStart + from);
        voices.forEach((midi, i) => {
          const beat = barStart + Math.min(from + i, edge - 1);
          notes.push({
            startBeat: beat,
            durationBeats: fit(beat, barStart + edge - beat),
            freq: midiToFrequency(midi),
            velocity: 0.3
          });
        });
        from = edge;
      }
    } else {
      const spans = late ? [
        [barStart, mid],
        [barStart + mid, beatsPerBar - mid]
      ] : [[barStart, beatsPerBar]];
      for (const [beat, span] of spans) {
        const dur = fit(beat, span);
        for (const midi of at(beat)) {
          notes.push({
            startBeat: beat,
            durationBeats: dur,
            freq: midiToFrequency(midi),
            velocity: 0.3
          });
        }
      }
    }
  }
  return notes;
}
function arrangeArp(ctx) {
  const { plan, beatsPerBar, bars, rootMidi, raga, fit, swung, active, texture, arpRng } = ctx;
  const arpRole = ctx.options.arpRole ?? "arp";
  if ((arpRole === "double" || arpRole === "harmony") && ctx.leadMelody.length > 0) {
    const octave = arpRole === "double" ? OCTAVE : 0;
    return ctx.leadMelody.map((n) => {
      const start = swung(n.startBeat);
      const degree = arpRole === "harmony" ? thirdBelow(raga, n.degree) : n.degree;
      return {
        startBeat: start,
        durationBeats: fit(start, n.durationBeats),
        freq: degreeToFrequency(raga, degree, rootMidi + octave),
        velocity: n.velocity * 0.7
        // sits just under the lead
      };
    });
  }
  if (arpRole === "counter") {
    const counter = [];
    const stride = 2;
    const loBand = rootMidi - 2;
    const hiBand = rootMidi + OCTAVE - 3;
    const lead = ctx.leadMelody;
    const leadMidi = (n) => rootMidi + degreeToSemitone(raga, n.degree);
    const leadSounds = (beat) => lead.some((n) => n.startBeat <= beat + 1e-9 && n.startBeat + n.durationBeats > beat + 1e-9);
    const leadAt = (beat) => {
      let last = null;
      let prior = null;
      for (const n of lead) {
        if (n.startBeat > beat + 1e-9) break;
        prior = last;
        last = n;
      }
      return { last, step: last && prior ? Math.sign(last.degree - prior.degree) : 0 };
    };
    let prevMidi = rootMidi + 2;
    let prevLead = null;
    for (let bar = 0; bar < bars; bar++) {
      const barPlan = plan.bars[bar];
      const tonesAt = (beat) => chordAt(barPlan, beat - bar * beatsPerBar, beatsPerBar).pcs.flatMap((pc) => [rootMidi + pc, rootMidi + pc + OCTAVE]).filter((m) => m >= loBand && m <= hiBand);
      if (tonesAt(bar * beatsPerBar).length === 0) continue;
      const barStart = bar * beatsPerBar;
      const entries = [];
      for (let b = 0; b < beatsPerBar; b += stride) {
        const slot = barStart + b;
        let at = slot;
        for (let k = 0; k < stride && slot + k < barStart + beatsPerBar; k++) {
          if (!leadSounds(slot + k)) {
            at = slot + k;
            break;
          }
        }
        entries.push(at);
      }
      for (const at of entries) {
        const start = swung(at);
        if (!active(texture.arp, start)) continue;
        const next = lead.find((n) => n.startBeat > at + 1e-9);
        const room = next ? Math.min(stride, next.startBeat - at) : stride;
        const { last, step } = leadAt(at);
        const here = last ? leadMidi(last) : null;
        const cands = tonesAt(at);
        if (cands.length === 0) continue;
        let pool = cands.filter((m) => m !== prevMidi);
        if (pool.length === 0) pool = cands;
        const contrary = pool.filter((m) => step === 0 || Math.sign(m - prevMidi) !== step);
        if (contrary.length > 0) pool = contrary;
        if (here !== null && prevLead !== null) {
          const wasApart = Math.abs(prevLead - prevMidi) % OCTAVE;
          const clean = pool.filter(
            (m) => !((wasApart === 7 || wasApart === 0) && Math.abs(here - m) % OCTAVE === wasApart && m !== prevMidi && here !== prevLead)
          );
          if (clean.length > 0) pool = clean;
        }
        const pick = pool.reduce(
          (best, m) => Math.abs(m - prevMidi) < Math.abs(best - prevMidi) ? m : best,
          pool[0]
        );
        counter.push({
          startBeat: start,
          durationBeats: fit(start, Math.max(0.5, room) * 0.95),
          freq: midiToFrequency(pick),
          velocity: 0.4
        });
        prevMidi = pick;
        prevLead = here;
      }
    }
    return counter;
  }
  const notes = [];
  const pattern = arpRng.pick(ARP_PATTERNS);
  const stepsPerBar = beatsPerBar * 2;
  for (let bar = 0; bar < bars; bar++) {
    const barPlan = plan.bars[bar];
    const early = arpSequence(barPlan.chord.pcs, pattern);
    const late = barPlan.second ? arpSequence(barPlan.second.chord.pcs, pattern) : early;
    for (let s = 0; s < stepsPerBar; s++) {
      const seq = s * 0.5 >= Math.floor(beatsPerBar / 2) ? late : early;
      const pc = seq[s % seq.length];
      const start = swung(bar * beatsPerBar + s * 0.5);
      if (!active(texture.arp, start)) continue;
      notes.push({
        startBeat: start,
        durationBeats: fit(start, 0.45),
        freq: midiToFrequency(rootMidi + OCTAVE + pc),
        velocity: 0.45
      });
    }
  }
  return notes;
}
var PART_ARRANGERS = [
  { voice: "lead", arrange: arrangeLead },
  { voice: "bass", arrange: arrangeBass },
  { voice: "pad", arrange: arrangePad },
  { voice: "arp", arrange: arrangeArp }
];
function themeSpanBars(motif, beatsPerBar) {
  const end = Math.max(...motif.map((n) => n.startBeat + n.durationBeats));
  return Math.max(1, Math.ceil(end / beatsPerBar));
}
function arrange(options) {
  const { rng } = options;
  const bpm = options.bpm ?? DEFAULT_BPM;
  const beatsPerBar = options.beatsPerBar ?? 4;
  const bars = options.bars ?? 8;
  const parent = options.parent ?? SCALES.major;
  const raga = options.raga ?? parent;
  const rootMidi = options.rootMidi ?? DEFAULT_ROOT_MIDI;
  const groove = options.groove ?? "straight";
  const density = options.density ?? 0.5;
  const swing = options.swing ?? 0;
  const leadRange = options.leadRange ?? [0, 7];
  if (!Number.isFinite(bpm) || bpm <= 0) {
    throw new RangeError(`arrange bpm must be a positive number, got ${bpm}`);
  }
  assertMusicalParams({ swing, density, rootMidi, groove, parent, raga });
  const lengthBeats = bars * beatsPerBar;
  const enabled = (v) => options.voices?.[v] ?? true;
  const drumsOn = options.voices?.drums ?? true;
  const fit = (start, dur) => Math.min(dur, lengthBeats - start);
  const swung = (beat) => applySwing(beat, swing);
  const texture = TEXTURES[options.texture ?? "full"];
  const sectionOf = (beat) => Math.min(TEXTURE_SECTIONS - 1, Math.floor(beat / lengthBeats * TEXTURE_SECTIONS));
  const active = (lane, beat) => lane[sectionOf(beat)] !== 0;
  const harmonyRng = rng.fork();
  const leadRng = rng.fork();
  const bassRng = rng.fork();
  const arpRng = rng.fork();
  const plan = options.plan ?? generateHarmony({
    rng: harmonyRng,
    scale: parent,
    rootMidi,
    bars,
    beatsPerBar,
    ...options.progression !== void 0 ? { progression: options.progression } : {},
    ...options.generateProgression !== void 0 ? { generate: options.generateProgression } : {},
    ...options.sevenths !== void 0 ? { sevenths: options.sevenths } : {},
    ...options.secondaryDominants !== void 0 ? { secondaryDominants: options.secondaryDominants } : {}
  });
  const theme = options.motif && options.motif.length > 0 ? developMotif(options.motif, options.development ?? PLAIN_STATEMENT, {
    beatsPerBar,
    motifBars: options.motifBars ?? themeSpanBars(options.motif, beatsPerBar),
    sectionBars: bars,
    range: leadRange,
    degreesPerOctave: raga.length,
    maxLeap: DEFAULT_MAX_LEAP2
  }) : null;
  const leadMelody = enabled("lead") ? generateMelody({
    rng: leadRng,
    plan,
    scale: raga,
    range: leadRange,
    density,
    ...options.paths !== void 0 ? { paths: options.paths } : {},
    ...options.contour !== void 0 ? { contour: options.contour } : {},
    ...theme ? { motif: theme.notes, motifBars: theme.bars } : {}
  }) : [];
  const ctx = {
    options,
    plan,
    raga,
    rootMidi,
    beatsPerBar,
    bars,
    leadMelody,
    texture,
    bassRng,
    arpRng,
    fit,
    swung,
    active
  };
  const parts = [];
  for (const part of PART_ARRANGERS) {
    if (enabled(part.voice)) parts.push({ voice: part.voice, notes: part.arrange(ctx) });
  }
  let drums = [];
  if (drumsOn) {
    const g = fitGroove(DRUM_GROOVES[groove], beatsPerBar);
    const lanes = [
      ["kick", g.kick, 1],
      ["snare", g.snare, 0.9],
      ["hat", g.hat, 0.45]
    ];
    for (let bar = 0; bar < bars; bar++) {
      for (const [drum, positions, velocity] of lanes) {
        for (const pos of positions) {
          const raw = bar * beatsPerBar + pos;
          const beat = drum === "hat" ? swung(raw) : raw;
          if (!active(texture.drums, beat)) continue;
          drums.push({ startBeat: beat, drum, velocity });
        }
      }
    }
    if (options.fill) {
      const lastBar = (bars - 1) * beatsPerBar;
      drums = drums.filter((h) => h.startBeat < lastBar);
      drums.push({ startBeat: lastBar, drum: "kick", velocity: 1 });
      const steps = beatsPerBar * 2;
      for (let s = 0; s < steps; s++) {
        drums.push({
          startBeat: lastBar + s * 0.5,
          drum: "snare",
          velocity: 0.45 + 0.55 * (s / Math.max(1, steps - 1))
          // crescendo into the next section
        });
      }
    }
  }
  const dynamics = options.dynamics ?? 1;
  const swell = (beat) => 1 + PHRASE_SWELL * (2 * Math.sin(Math.PI * phrasePosition(beat, beatsPerBar)) - 1);
  const pitched = (v, beat) => Math.min(1, v * dynamics * swell(beat));
  const struck = (v) => Math.min(1, v * dynamics);
  return {
    bpm,
    beatsPerBar,
    bars,
    lengthBeats,
    rootMidi,
    parts: parts.map((p) => ({
      voice: p.voice,
      notes: p.notes.map((n) => ({ ...n, velocity: pitched(n.velocity, n.startBeat) }))
    })),
    drums: drums.map((h) => ({ ...h, velocity: struck(h.velocity) }))
  };
}
var PHRASE_BARS = 4;
var PHRASE_SWELL = 0.14;
function phrasePosition(beat, beatsPerBar) {
  const phraseLen = PHRASE_BARS * beatsPerBar;
  return (beat % phraseLen + phraseLen) % phraseLen / phraseLen;
}

// src/instruments.ts
var REVERB_SEND_BY_VOICE = {
  lead: 0.2,
  bass: 0.05,
  pad: 0.5,
  arp: 0.35
};
var MIX_BY_VOICE = {
  lead: 1.12,
  bass: 1,
  pad: 0.82,
  arp: 0.88
};
var PAN_BY_VOICE = {
  lead: 0,
  bass: 0,
  pad: -0.3,
  arp: 0.3
};
var INSTRUMENTS = {
  // ── leads ──
  pluck: {
    name: "pluck",
    voices: ["lead", "arp"],
    layers: [{ kind: "sawtooth" }],
    amp: { attack: 5e-3, decay: 0.14, sustain: 0.28, release: 0.16 },
    filter: { type: "lowpass", cutoff: 1400, q: 2, envAmount: 2600, envDecay: 0.14 },
    reverbSend: 0.2
  },
  marimba: {
    name: "marimba",
    voices: ["lead", "arp"],
    layers: [{ kind: "triangle" }, { kind: "sine", ratio: 4, gain: 0.25 }],
    amp: { attack: 3e-3, decay: 0.28, sustain: 0, release: 0.2 },
    reverbSend: 0.25
  },
  squareLead: {
    name: "squareLead",
    voices: ["lead"],
    layers: [{ kind: "square" }, { kind: "square", detuneCents: 8, gain: 0.5 }],
    amp: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.12 },
    filter: { type: "lowpass", cutoff: 3e3, q: 0.8 },
    gain: 0.85,
    reverbSend: 0.15
  },
  sineLead: {
    name: "sineLead",
    voices: ["lead"],
    layers: [{ kind: "sine" }, { kind: "sine", ratio: 2, gain: 0.25 }],
    amp: { attack: 0.02, decay: 0.12, sustain: 0.6, release: 0.18 },
    vibrato: { rateHz: 5, depthCents: 9, delaySec: 0.6 },
    // a gentle, late shimmer (not a wobble)
    reverbSend: 0.25
  },
  airLead: {
    name: "airLead",
    // An airy, breathy soft lead (honestly NOT a flute — blown instruments need a
    // breath model/samples). Shows off the noise layer as a gentle texture.
    voices: ["lead"],
    layers: [{ kind: "sine" }, { kind: "sine", ratio: 2, gain: 0.06 }],
    amp: { attack: 0.06, decay: 0.1, sustain: 0.7, release: 0.18 },
    // soft onset
    vibrato: { rateHz: 5, depthCents: 12, delaySec: 0.4 },
    noise: { gain: 0.05, highpass: 2e3 },
    // a wisp of air
    reverbSend: 0.3
  },
  clarinet: {
    name: "clarinet",
    // Reed: a hollow square (odd harmonics) with breath + gentle vibrato.
    voices: ["lead"],
    layers: [{ kind: "square" }],
    amp: { attack: 0.04, decay: 0.1, sustain: 0.8, release: 0.15 },
    filter: { type: "lowpass", cutoff: 1800, q: 0.7 },
    vibrato: { rateHz: 5, depthCents: 7, delaySec: 0.5 },
    noise: { gain: 0.03, highpass: 2500 },
    // breath
    gain: 0.7,
    // square runs hot
    reverbSend: 0.25
  },
  synthBrass: {
    name: "synthBrass",
    // Brass: bright detuned saws with a filter "bloom" on the attack + a wisp of air.
    voices: ["lead", "pad"],
    layers: [{ kind: "sawtooth" }, { kind: "sawtooth", detuneCents: 6, gain: 0.5 }],
    amp: { attack: 0.04, decay: 0.2, sustain: 0.8, release: 0.2 },
    filter: { type: "lowpass", cutoff: 1200, q: 1, envAmount: 2400, envDecay: 0.12 },
    vibrato: { rateHz: 5, depthCents: 6, delaySec: 0.5 },
    noise: { gain: 0.02, highpass: 4e3 },
    gain: 0.9,
    reverbSend: 0.25
  },
  supersaw: {
    name: "supersaw",
    // Lush stacked detuned saws — a rich synth lead/pad.
    voices: ["lead", "pad"],
    layers: [
      { kind: "sawtooth" },
      { kind: "sawtooth", detuneCents: 12, gain: 0.7 },
      { kind: "sawtooth", detuneCents: -12, gain: 0.7 },
      { kind: "sawtooth", detuneCents: 24, gain: 0.4 }
    ],
    amp: { attack: 0.02, decay: 0.2, sustain: 0.75, release: 0.25 },
    filter: { type: "lowpass", cutoff: 2600, q: 0.6 },
    vibrato: { rateHz: 4.5, depthCents: 6, delaySec: 0.6 },
    gain: 0.8,
    // four saws sum hot
    reverbSend: 0.3
  },
  // ── pads ──
  warmPad: {
    name: "warmPad",
    voices: ["pad"],
    layers: [
      { kind: "sawtooth" },
      { kind: "sawtooth", detuneCents: 10, gain: 0.6 },
      { kind: "sine", ratio: 0.5, gain: 0.4 }
    ],
    amp: { attack: 0.35, decay: 0.4, sustain: 0.85, release: 0.6 },
    filter: { type: "lowpass", cutoff: 1800, q: 0.6 },
    gain: 0.9,
    reverbSend: 0.55
  },
  glassPad: {
    name: "glassPad",
    voices: ["pad"],
    layers: [{ kind: "triangle" }, { kind: "triangle", ratio: 2, detuneCents: 6, gain: 0.4 }],
    amp: { attack: 0.3, decay: 0.3, sustain: 0.8, release: 0.5 },
    reverbSend: 0.6
  },
  organ: {
    name: "organ",
    voices: ["pad"],
    layers: [
      { kind: "sine" },
      { kind: "sine", ratio: 2, gain: 0.6 },
      { kind: "sine", ratio: 3, gain: 0.35 }
    ],
    amp: { attack: 0.02, decay: 0.1, sustain: 0.9, release: 0.2 },
    tremolo: { rateHz: 4.5, depth: 0.16 },
    // subtle Leslie-ish shimmer
    reverbSend: 0.3
  },
  epiano: {
    name: "epiano",
    voices: ["lead", "pad"],
    // FM Rhodes: a sine carrier with a unison modulator whose brightness decays
    // into a soft tine, plus a faint octave shimmer.
    layers: [
      { kind: "sine", fm: { ratio: 1, index: 2.5, decay: 0.35 } },
      { kind: "sine", ratio: 2, gain: 0.12 }
    ],
    amp: { attack: 5e-3, decay: 0.7, sustain: 0.3, release: 0.5 },
    reverbSend: 0.32
  },
  strings: {
    name: "strings",
    // Ensemble strings: three detuned saws, slow swell, bow noise + vibrato.
    voices: ["pad", "lead"],
    layers: [
      { kind: "sawtooth" },
      { kind: "sawtooth", detuneCents: 11, gain: 0.7 },
      { kind: "sawtooth", detuneCents: -7, gain: 0.5 }
    ],
    amp: { attack: 0.25, decay: 0.3, sustain: 0.85, release: 0.5 },
    filter: { type: "lowpass", cutoff: 2400, q: 0.6 },
    vibrato: { rateHz: 5.5, depthCents: 8, delaySec: 0.5 },
    noise: { gain: 0.03, highpass: 3e3 },
    // bow
    gain: 0.9,
    reverbSend: 0.5
  },
  choir: {
    name: "choir",
    // Voices on "aah": detuned saws run through a vowel formant bank, with a slow
    // swell, vibrato and a wisp of breath. The formant peaks make it read as vocal.
    voices: ["pad", "lead"],
    layers: [{ kind: "sawtooth" }, { kind: "sawtooth", detuneCents: 9, gain: 0.5 }],
    amp: { attack: 0.18, decay: 0.25, sustain: 0.85, release: 0.45 },
    formant: [
      { freq: 800, q: 8, gain: 1 },
      // F1 "aah"
      { freq: 1150, q: 10, gain: 0.6 },
      // F2
      { freq: 2900, q: 12, gain: 0.3 }
      // F3
    ],
    vibrato: { rateHz: 5, depthCents: 14, delaySec: 0.5 },
    noise: { gain: 0.03, highpass: 3e3 },
    // breath
    gain: 0.6,
    // saws + resonant bands run hot
    reverbSend: 0.55
  },
  // ── bass ──
  subBass: {
    name: "subBass",
    voices: ["bass"],
    layers: [{ kind: "sine" }, { kind: "sine", ratio: 2, gain: 0.2 }],
    amp: { attack: 5e-3, decay: 0.1, sustain: 0.85, release: 0.12 },
    reverbSend: 0.05
  },
  roundBass: {
    name: "roundBass",
    voices: ["bass"],
    layers: [{ kind: "triangle" }, { kind: "sawtooth", gain: 0.3 }],
    amp: { attack: 5e-3, decay: 0.12, sustain: 0.7, release: 0.12 },
    filter: { type: "lowpass", cutoff: 900, q: 0.8 },
    reverbSend: 0.08
  },
  // ── arp / sparkle ──
  bell: {
    name: "bell",
    voices: ["arp"],
    layers: [
      { kind: "sine" },
      { kind: "sine", ratio: 2.76, gain: 0.4 },
      { kind: "sine", ratio: 5.4, gain: 0.15 }
    ],
    amp: { attack: 2e-3, decay: 0.5, sustain: 0, release: 0.4 },
    reverbSend: 0.45
  },
  musicBox: {
    name: "musicBox",
    voices: ["arp"],
    layers: [{ kind: "triangle" }, { kind: "triangle", ratio: 4, gain: 0.2 }],
    amp: { attack: 2e-3, decay: 0.35, sustain: 0, release: 0.3 },
    reverbSend: 0.4
  },
  glockenspiel: {
    name: "glockenspiel",
    // Bright metallic ping via inharmonic FM, fast tine decay.
    voices: ["arp"],
    layers: [
      { kind: "sine", fm: { ratio: 3.5, index: 4, decay: 0.18 } },
      { kind: "sine", gain: 0.5 }
    ],
    amp: { attack: 1e-3, decay: 0.5, sustain: 0, release: 0.45 },
    reverbSend: 0.45
  },
  celesta: {
    name: "celesta",
    // Sweet mallet-bell: harmonic FM, gentler index than the glock, soft decay.
    voices: ["arp", "pad"],
    layers: [
      { kind: "sine", fm: { ratio: 3, index: 2, decay: 0.3 } },
      { kind: "sine", gain: 0.4 }
    ],
    amp: { attack: 2e-3, decay: 0.6, sustain: 0, release: 0.5 },
    reverbSend: 0.42
  },
  tubularBell: {
    name: "tubularBell",
    // Big church bell: inharmonic FM partials, long ring.
    voices: ["arp", "pad"],
    layers: [
      { kind: "sine", fm: { ratio: 1.4, index: 5, decay: 0.6 } },
      { kind: "sine", ratio: 2.8, gain: 0.3 }
    ],
    amp: { attack: 2e-3, decay: 1.2, sustain: 0, release: 1 },
    reverbSend: 0.55
  },
  harp: {
    name: "harp",
    // Soft plucked string: warm triangle, quick bloom, gentle decay.
    voices: ["arp", "lead"],
    layers: [{ kind: "triangle" }, { kind: "sine", ratio: 2, gain: 0.3 }],
    amp: { attack: 2e-3, decay: 0.6, sustain: 0, release: 0.5 },
    filter: { type: "lowpass", cutoff: 3e3, q: 0.5 },
    reverbSend: 0.4
  },
  synthArp: {
    name: "synthArp",
    voices: ["arp", "lead"],
    layers: [{ kind: "square" }],
    amp: { attack: 4e-3, decay: 0.12, sustain: 0.2, release: 0.1 },
    filter: { type: "lowpass", cutoff: 2200, q: 1.5, envAmount: 1800, envDecay: 0.1 },
    reverbSend: 0.3
  }
};
function instrumentsForVoice(voice) {
  return Object.keys(INSTRUMENTS).filter(
    (name) => INSTRUMENTS[name].voices.includes(voice)
  );
}
var DRUM_KITS = {
  default: {
    kick: {
      kind: "tone",
      gain: 0.9,
      ampDecay: 0.16,
      freqStart: 120,
      freqEnd: 48,
      pitchDecay: 0.03
    },
    snare: {
      kind: "mixed",
      gain: 0.5,
      ampDecay: 0.14,
      freqStart: 190,
      noiseGain: 0.7,
      toneGain: 0.3,
      highpass: 1200
    },
    hat: { kind: "noise", gain: 0.4, ampDecay: 0.05, noiseGain: 1, highpass: 7e3 }
  }
};
function bodyPitch(voice) {
  if (voice.kind === "tone") return voice.freqEnd;
  if (voice.kind === "mixed") return voice.freqStart;
  return null;
}
function shiftToConsonance(freq, rootMidi) {
  const pc = (n) => (n % 12 + 12) % 12;
  const from = pc(Math.round(69 + 12 * Math.log2(freq / 440)));
  let best = 0;
  let bestDistance = Infinity;
  for (const target of [0, 7]) {
    let shift = (pc(rootMidi + target) - from + 12) % 12;
    if (shift > 6) shift -= 12;
    if (Math.abs(shift) < bestDistance) {
      bestDistance = Math.abs(shift);
      best = shift;
    }
  }
  return best;
}
function tuneKit(kit, rootMidi) {
  const tuned = {};
  for (const [name, voice] of Object.entries(kit)) {
    const body = bodyPitch(voice);
    if (body === null || !(body > 0) || voice.kind === "noise") {
      tuned[name] = voice;
      continue;
    }
    const ratio = 2 ** (shiftToConsonance(body, rootMidi) / 12);
    tuned[name] = voice.kind === "tone" ? { ...voice, freqStart: voice.freqStart * ratio, freqEnd: voice.freqEnd * ratio } : { ...voice, freqStart: voice.freqStart * ratio };
  }
  return tuned;
}

// src/noise.ts
var DEFAULT_NOISE_LENGTH = 44100;
function makeNoiseTable(rng, length = DEFAULT_NOISE_LENGTH) {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError(`makeNoiseTable length must be a positive integer, got ${length}`);
  }
  const table = new Float32Array(length);
  for (let i = 0; i < length; i++) table[i] = rng.next() * 2 - 1;
  return table;
}

// src/styles.ts
var STYLES = {
  peppy: {
    name: "peppy",
    keys: [
      { parent: SCALES.major, raga: SCALES.mohanam },
      { parent: SCALES.major, raga: SCALES.hamsadhwani },
      { parent: SCALES.major, raga: SCALES.shuddhaSaveri },
      { parent: SCALES.mixolydian, raga: SCALES.madhyamavati },
      { parent: SCALES.lydian, raga: SCALES.kalyani },
      // bright, floaty (#4)
      { parent: SCALES.lydian, raga: SCALES.majorPentatonic, carnatic: false },
      { parent: SCALES.major, raga: SCALES.majorPentatonic, carnatic: false },
      { parent: SCALES.major, raga: SCALES.bilahari, paths: RAGA_PATHS.bilahari }
      // climbs bright, comes down full
    ],
    grooves: ["straight", "fourOnFloor", "busy", "syncopated"],
    bpm: [104, 132],
    swing: [0, 0.3],
    density: [0.5, 0.8],
    rootMidi: [57, 64],
    sevenths: [4],
    // V7 only — a touch of pull, stays bright
    instruments: {
      lead: ["pluck", "marimba", "squareLead", "synthBrass", "supersaw"],
      pad: ["warmPad", "glassPad", "organ", "strings", "supersaw"],
      arp: ["pluck", "bell", "musicBox", "glockenspiel", "celesta", "harp"],
      bass: ["subBass", "roundBass"]
    }
  },
  calm: {
    name: "calm",
    keys: [
      { parent: SCALES.naturalMinor, raga: SCALES.hindolam },
      { parent: SCALES.dorian, raga: SCALES.abhogi },
      { parent: SCALES.major, raga: SCALES.mohanam },
      { parent: SCALES.phrygian, raga: SCALES.hindolam },
      // dark, gentle
      { parent: SCALES.melodicMinor, raga: SCALES.abhogi },
      // wistful
      { parent: SCALES.dorian, raga: SCALES.minorPentatonic, carnatic: false },
      { parent: SCALES.dorian, raga: SCALES.sriranjani },
      // wistful, fifth-less
      { parent: SCALES.mixolydian, raga: SCALES.kambhoji, paths: RAGA_PATHS.kambhoji }
      // warm, the b7 only on the way down
    ],
    grooves: ["soft", "halfTime", "waltz"],
    bpm: [68, 92],
    swing: [0, 0.4],
    density: [0.2, 0.5],
    rootMidi: [55, 62],
    sevenths: [1, 4, 5],
    // ii7 · V7 · vi7 — gently warm
    instruments: {
      lead: ["sineLead", "marimba", "epiano", "airLead", "clarinet", "strings", "harp"],
      pad: ["warmPad", "glassPad", "epiano", "strings", "tubularBell", "choir"],
      arp: ["musicBox", "bell", "glockenspiel", "celesta", "harp", "tubularBell"],
      bass: ["subBass", "roundBass"]
    }
  },
  playful: {
    name: "playful",
    keys: [
      { parent: SCALES.major, raga: SCALES.hamsadhwani },
      { parent: SCALES.mixolydian, raga: SCALES.madhyamavati },
      { parent: SCALES.major, raga: SCALES.mohanam },
      { parent: SCALES.lydian, raga: SCALES.kalyani },
      { parent: SCALES.major, raga: SCALES.majorPentatonic, carnatic: false },
      { parent: SCALES.mayamalavagowla, raga: SCALES.mayamalavagowla },
      // exotic spice
      { parent: SCALES.major, raga: SCALES.arabhi, paths: RAGA_PATHS.arabhi }
      // bold ascent, full descent
    ],
    grooves: [
      "fourOnFloor",
      "busy",
      "straight",
      "syncopated",
      "breakbeat",
      "halfDouble",
      "sixEight"
    ],
    bpm: [112, 140],
    swing: [0.1, 0.4],
    density: [0.6, 0.9],
    rootMidi: [57, 64],
    sevenths: [4],
    // V7 only — bright and simple
    instruments: {
      lead: ["squareLead", "pluck", "synthArp", "synthBrass", "supersaw"],
      pad: ["organ", "glassPad", "strings", "supersaw"],
      arp: ["synthArp", "pluck", "musicBox", "glockenspiel", "celesta", "harp"],
      bass: ["roundBass", "subBass"]
    }
  },
  dreamy: {
    name: "dreamy",
    keys: [
      { parent: SCALES.major, raga: SCALES.shuddhaSaveri },
      { parent: SCALES.dorian, raga: SCALES.abhogi },
      { parent: SCALES.naturalMinor, raga: SCALES.hindolam },
      { parent: SCALES.lydian, raga: SCALES.majorPentatonic, carnatic: false },
      // floaty
      { parent: SCALES.harmonicMinor, raga: SCALES.harmonicMinor, carnatic: false },
      // dramatic
      { parent: SCALES.phrygian, raga: SCALES.minorPentatonic, carnatic: false },
      // dark
      { parent: SCALES.melodicMinor, raga: SCALES.abhogi },
      { parent: SCALES.dorian, raga: SCALES.sriranjani },
      {
        parent: SCALES.lydian,
        raga: SCALES.mohanakalyani,
        paths: RAGA_PATHS.mohanakalyani
        // pentatonic up, the #4 waiting on the way down
      }
    ],
    grooves: ["soft", "halfTime", "straight", "waltz", "sixEight"],
    bpm: [72, 100],
    swing: [0, 0.3],
    density: [0.3, 0.6],
    rootMidi: [55, 62],
    sevenths: [0, 1, 3, 4, 5],
    // lush: maj7 tonic and sevenths throughout
    instruments: {
      lead: ["sineLead", "marimba", "epiano", "airLead", "clarinet", "strings", "harp"],
      pad: ["glassPad", "warmPad", "epiano", "strings", "tubularBell", "choir"],
      arp: ["bell", "musicBox", "glockenspiel", "celesta", "harp", "tubularBell"],
      bass: ["subBass", "roundBass"]
    }
  },
  lofi: {
    name: "lofi",
    keys: [
      { parent: SCALES.dorian, raga: SCALES.abhogi },
      { parent: SCALES.naturalMinor, raga: SCALES.hindolam },
      { parent: SCALES.major, raga: SCALES.mohanam },
      { parent: SCALES.melodicMinor, raga: SCALES.abhogi },
      { parent: SCALES.charukesi, raga: SCALES.charukesi }
    ],
    grooves: ["halfTime", "soft", "breakbeat"],
    bpm: [68, 88],
    swing: [0.2, 0.5],
    // dusty shuffle
    density: [0.3, 0.55],
    rootMidi: [55, 62],
    sevenths: [0, 1, 2, 3, 4, 5, 6],
    // sevenths on everything — the lofi signature
    instruments: {
      lead: ["epiano", "sineLead", "marimba", "clarinet"],
      pad: ["warmPad", "epiano", "choir", "glassPad"],
      arp: ["musicBox", "bell", "harp", "celesta"],
      bass: ["roundBass", "subBass"]
    }
  },
  cinematic: {
    name: "cinematic",
    keys: [
      { parent: SCALES.harmonicMinor, raga: SCALES.harmonicMinor, carnatic: false },
      // dramatic
      { parent: SCALES.naturalMinor, raga: SCALES.hindolam },
      { parent: SCALES.lydian, raga: SCALES.kalyani },
      // bright/epic
      { parent: SCALES.phrygian, raga: SCALES.minorPentatonic, carnatic: false },
      // dark
      { parent: SCALES.melodicMinor, raga: SCALES.abhogi },
      { parent: SCALES.phrygian, raga: SCALES.revati },
      { parent: SCALES.charukesi, raga: SCALES.charukesi }
      // bittersweet
    ],
    grooves: ["halfTime", "straight", "soft", "sixEight"],
    bpm: [70, 100],
    swing: [0, 0.2],
    density: [0.35, 0.65],
    rootMidi: [52, 60],
    // weighty, lower register
    sevenths: [1, 3, 4, 5],
    // rich, but a clean triad tonic for gravitas
    instruments: {
      lead: ["strings", "airLead", "choir", "sineLead"],
      pad: ["strings", "choir", "warmPad", "glassPad"],
      arp: ["harp", "glockenspiel", "celesta", "tubularBell"],
      bass: ["subBass", "roundBass"]
    }
  },
  ambient: {
    name: "ambient",
    keys: [
      { parent: SCALES.lydian, raga: SCALES.majorPentatonic, carnatic: false },
      // floaty
      { parent: SCALES.major, raga: SCALES.shuddhaSaveri },
      { parent: SCALES.dorian, raga: SCALES.abhogi },
      { parent: SCALES.lydian, raga: SCALES.kalyani },
      { parent: SCALES.mixolydian, raga: SCALES.madhyamavati },
      { parent: SCALES.phrygian, raga: SCALES.revati }
      // serene, exotic
    ],
    grooves: ["soft", "halfTime", "none", "waltz", "sixEight"],
    // often drumless
    bpm: [56, 76],
    swing: [0, 0.2],
    density: [0.15, 0.4],
    // sparse, floating
    rootMidi: [55, 64],
    sevenths: [0, 1, 3, 4, 5],
    // floaty maj7 colour
    instruments: {
      lead: ["airLead", "choir", "sineLead", "strings"],
      pad: ["warmPad", "glassPad", "choir", "strings", "tubularBell"],
      arp: ["bell", "musicBox", "celesta", "glockenspiel", "harp"],
      bass: ["subBass"]
    }
  }
};
var VOICES = ["lead", "bass", "pad", "arp"];
var rangeInt = (rng, [lo, hi]) => lo + rng.int(hi - lo + 1);
var rangeFloat = (rng, [lo, hi]) => lo + rng.next() * (hi - lo);
function resolvePools(shortlists) {
  const out = {};
  for (const voice of VOICES) {
    const suitable = instrumentsForVoice(voice);
    const listed = shortlists?.[voice];
    const filtered = listed?.filter((name) => suitable.includes(name));
    out[voice] = filtered && filtered.length > 0 ? filtered : suitable;
  }
  return out;
}
function pickStyle(rng, name = "peppy") {
  if (!(name in STYLES)) {
    throw new RangeError(`pickStyle: unknown style "${name}"`);
  }
  const style = STYLES[name];
  const key = rng.pick(style.keys);
  const groove = rng.pick(style.grooves);
  const rootMidi = rangeInt(rng, style.rootMidi);
  const bpm = rangeInt(rng, style.bpm);
  const swing = rangeFloat(rng, style.swing);
  const density = rangeFloat(rng, style.density);
  return {
    parent: key.parent,
    raga: key.raga,
    ...key.paths !== void 0 ? { paths: key.paths } : {},
    ...key.carnatic !== void 0 ? { carnatic: key.carnatic } : {},
    ...style.sevenths !== void 0 ? { sevenths: style.sevenths } : {},
    rootMidi,
    groove,
    bpm,
    swing,
    density,
    instruments: resolvePools(style.instruments)
  };
}

// src/wav.ts
function encodeWav(channels, sampleRate) {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`encodeWav sampleRate must be a positive integer, got ${sampleRate}`);
  }
  if (channels.length === 0) {
    throw new RangeError("encodeWav requires at least one channel");
  }
  const numChannels = channels.length;
  const frames = channels[0].length;
  const blockAlign = numChannels * 2;
  const dataLength = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataLength);
  const dv = new DataView(buffer);
  const writeText = (offset2, text) => {
    for (let i = 0; i < text.length; i++) dv.setUint8(offset2 + i, text.charCodeAt(i));
  };
  writeText(0, "RIFF");
  dv.setUint32(4, 36 + dataLength, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, numChannels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 16, true);
  writeText(36, "data");
  dv.setUint32(40, dataLength, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = channels[ch][frame] ?? 0;
      const safe = Number.isNaN(sample) ? 0 : Math.max(-1, Math.min(1, sample));
      dv.setInt16(offset, Math.round(safe * 32767), true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}

// src/compose/form.ts
function orchestration(index, total, kind) {
  if (kind === "kriti") return {};
  if (index === 0) return { arp: false };
  if (index === total - 1 && total >= 4) return { drums: false };
  return {};
}
function buildIntro(o, home) {
  const bars = Math.max(4, Math.round(o.bars / 2));
  return {
    ...home,
    part: "intro",
    label: "intro",
    bars,
    // The home progression's own opening bars, so the intro previews the harmony the
    // piece is about to state rather than announcing something it never returns to.
    plan: { ...home.plan, bars: home.plan.bars.slice(0, bars), cadences: { half: -1, final: -1 } },
    texture: "full",
    density: clampDensity(o.density * 0.5),
    dynamics: 0.85,
    development: PLAIN_STATEMENT,
    voices: { lead: false, arp: false, drums: false },
    fill: false
  };
}
var MOTIF_BARS = 2;
var FORM_TEMPLATES = [
  { kind: "song", parts: ["A", "A", "B", "A"] },
  // AABA — classic 32-bar song form
  { kind: "song", parts: ["A", "B", "A", "B"] },
  // verse/chorus
  { kind: "song", parts: ["A", "B", "A", "C"] },
  // verse/bridge/verse/climax
  { kind: "song", parts: ["A", "B", "A", "B", "A", "C"] },
  // longer arc to a climax
  { kind: "song", parts: ["A", "A", "B", "A", "B", "A"] },
  // extended AABA
  { kind: "song", parts: ["A", "B", "A", "C", "A"] },
  // rondo-ish, returns home
  { kind: "song", parts: ["A", "B", "C", "A"] },
  // build through bridge to climax, then home
  // The kriti cycle: pallavi · anupallavi · pallavi · charanam · pallavi.
  { kind: "kriti", parts: ["A", "B", "A", "C", "A"] }
];
var PART_NAMES = {
  kriti: { A: "pallavi", B: "anupallavi", C: "charanam" }
};
function kritiRange(label, octave) {
  const span = DEFAULT_RANGE2[1];
  if (label === "B") return [octave, octave + span];
  if (label === "C") return [0, span + Math.ceil(octave / 2)];
  return [0, span];
}
var DEFAULT_RANGE2 = [0, 7];
var clampDensity = (d) => Math.min(0.95, Math.max(0.05, d));
var modulate = (base, shift) => {
  const m = base + shift;
  return m >= 40 && m <= 78 ? m : base;
};
var sparser = (g) => DRUM_GROOVES[g].beatsPerBar !== 4 ? g : g === "halfTime" || g === "soft" || g === "none" ? "soft" : "halfTime";
var busier = (g) => DRUM_GROOVES[g].beatsPerBar !== 4 ? g : g === "busy" || g === "halfDouble" ? "fourOnFloor" : "busy";
var BRIDGE_DEVELOPMENT = [
  { transform: "inversion", step: 0 },
  { transform: "fragmentation", step: 1 },
  { transform: "fragmentation", step: -1 },
  { transform: "sequence", step: -2 }
];
var CLIMAX_DEVELOPMENT = [
  { transform: "augmentation", step: 0 },
  { transform: "sequence", step: 2 },
  { transform: "sequence", step: 1 }
];
function sectionBars(label, o, kind) {
  return kind === "kriti" && label === "C" ? Math.round(o.bars * 1.5) : o.bars;
}
function sectionRoot(label, o, kind) {
  if (kind === "kriti") return o.rootMidi;
  if (label === "B") return modulate(o.rootMidi, o.rng.pick([0, 5, 7, -5]));
  if (label === "C") return modulate(o.rootMidi, o.rng.pick([0, 2, 5]));
  return o.rootMidi;
}
var ANUPALLAVI_DEVELOPMENT = [
  { transform: "sequence", step: 2 },
  { transform: "sequence", step: 1 },
  { transform: "inversion", step: 0 }
];
var CHARANAM_DEVELOPMENT = [
  { transform: "augmentation", step: 0 },
  { transform: "fragmentation", step: 1 },
  { transform: "sequence", step: -1 }
];
function kritiSection(label, o, rootMidi, plan, bars) {
  const shared = {
    label,
    rootMidi,
    plan,
    bars,
    bpmScale: 1,
    // the tala doesn't shift mid-piece
    groove: o.groove,
    voices: {},
    // the ensemble plays throughout
    padPattern: "sustain",
    // a held bed, standing in for the drone
    range: kritiRange(label, o.raga.length),
    part: PART_NAMES.kriti[label] ?? label
  };
  if (label === "B") {
    return {
      ...shared,
      texture: "build",
      bassPattern: o.rng.pick(["rootFifth", "walking"]),
      density: clampDensity(o.density * 1.1),
      contour: o.rng.pick(["rising", "arch"]),
      dynamics: 1.06,
      arpRole: o.rng.pick(["harmony", "arp"]),
      development: o.rng.pick(ANUPALLAVI_DEVELOPMENT)
    };
  }
  if (label === "C") {
    return {
      ...shared,
      texture: "full",
      bassPattern: "rootFifth",
      density: clampDensity(o.density),
      contour: "rising",
      dynamics: 1.04,
      arpRole: o.rng.pick(["arp", "harmony"]),
      development: o.rng.pick(CHARANAM_DEVELOPMENT)
    };
  }
  return {
    ...shared,
    texture: "full",
    bassPattern: o.rng.pick(["rootFifth", "sustained"]),
    density: clampDensity(o.density),
    contour: o.rng.pick(["arch", "flat"]),
    dynamics: 1,
    arpRole: "arp",
    development: PLAIN_STATEMENT
  };
}
function buildSection(label, o, kind) {
  const rootMidi = sectionRoot(label, o, kind);
  const bars = sectionBars(label, o, kind);
  const plan = generateHarmony({
    rng: o.rng.fork(),
    scale: o.scale,
    rootMidi,
    bars,
    beatsPerBar: o.beatsPerBar,
    borrow: o.borrow,
    secondaryDominants: o.secondaryDominants,
    ...o.sevenths !== void 0 ? { sevenths: o.sevenths } : {}
  });
  if (kind === "kriti") return kritiSection(label, o, rootMidi, plan, bars);
  if (label === "B") {
    return {
      label,
      rootMidi,
      plan,
      texture: o.rng.pick(["breakdown", "build", "pulse"]),
      bassPattern: o.rng.pick(["sustained", "walking", "rootFifth"]),
      density: clampDensity(o.density * 0.6),
      contour: o.rng.pick(["falling", "flat", "arch"]),
      dynamics: 0.82,
      bpmScale: 0.96,
      // bridge eases back a touch
      groove: sparser(o.groove),
      voices: { drums: false },
      // drums drop out — an intimate, drumless bridge
      arpRole: o.rng.pick(["harmony", "counter"]),
      // two-part bridge: parallel harmony or an antiphonal counter
      padPattern: "broken",
      // pad drifts through the chord — gentle bridge movement
      development: o.rng.pick(BRIDGE_DEVELOPMENT),
      range: DEFAULT_RANGE2,
      part: label,
      bars
    };
  }
  if (label === "C") {
    return {
      label,
      rootMidi,
      plan,
      texture: "full",
      bassPattern: "pulse",
      density: clampDensity(o.density * 1.25),
      contour: o.rng.pick(["rising", "arch"]),
      dynamics: 1.12,
      bpmScale: 1.06,
      // climax pushes ahead
      groove: busier(o.groove),
      voices: {},
      // full ensemble
      arpRole: "double",
      // the arp doubles the theme an octave up — a tutti climax
      padPattern: "stabs",
      // pad punches on each beat — drives the climax
      development: o.rng.pick(CLIMAX_DEVELOPMENT),
      range: DEFAULT_RANGE2,
      part: label,
      bars
    };
  }
  return {
    label,
    rootMidi,
    plan,
    texture: "full",
    bassPattern: o.rng.pick(["rootFifth", "rootFifth", "walking"]),
    density: clampDensity(o.density),
    contour: o.rng.pick(["arch", "arch", "rising", "flat"]),
    dynamics: 1,
    bpmScale: 1,
    // home tempo
    groove: o.groove,
    // home groove (the style's pick)
    voices: {},
    // full ensemble
    arpRole: "arp",
    // the arp keeps the running figure — the bed
    padPattern: "sustain",
    // pad holds the chord — the steady bed
    development: PLAIN_STATEMENT,
    // the refrain returns as itself
    range: DEFAULT_RANGE2,
    part: label,
    bars
  };
}
function buildForm(o) {
  const drawn = o.rng.pick(FORM_TEMPLATES);
  const template = o.form === void 0 ? drawn : FORM_TEMPLATES.find((t) => t.kind === o.form) ?? drawn;
  const { kind, parts } = template;
  const recipes = /* @__PURE__ */ new Map();
  for (const label of parts) {
    if (!recipes.has(label)) recipes.set(label, buildSection(label, o, kind));
  }
  const sections = parts.map((label, i) => {
    const recipe = recipes.get(label);
    return {
      ...recipe,
      // The part's own scoring, then the arc across the piece — so a section that
      // recurs is not orchestrated identically every time it comes round.
      voices: { ...recipe.voices, ...orchestration(i, parts.length, kind) },
      fill: parts[(i + 1) % parts.length] !== label
      // fill into a part change (incl. the loop wrap)
    };
  });
  const home = recipes.get("A");
  const motif = generateMelody({
    rng: o.rng.fork(),
    plan: {
      ...home.plan,
      bars: home.plan.bars.slice(0, MOTIF_BARS),
      cadences: { half: -1, final: -1 }
    },
    scale: o.raga,
    density: o.density,
    ...o.paths !== void 0 ? { paths: o.paths } : {}
  });
  const intro = o.intro === false ? null : buildIntro(o, home);
  return { kind, intro, sections, motif, motifBars: MOTIF_BARS };
}

// src/compose/closing.ts
var CLOSING_BARS = 2;
function closingScore(o) {
  const { parent, raga, rootMidi, bpm, beatsPerBar } = o;
  const lengthBeats = CLOSING_BARS * beatsPerBar;
  const tonic = diatonicChord(parent, 0);
  const held = { startBeat: 0, durationBeats: lengthBeats };
  return {
    bpm,
    beatsPerBar,
    bars: CLOSING_BARS,
    lengthBeats,
    rootMidi,
    parts: [
      {
        voice: "lead",
        // The upper tonic, where the lead has been singing all along — arriving in a
        // register it never used would read as a new idea, not a conclusion.
        notes: [{ ...held, freq: degreeToFrequency(raga, raga.length, rootMidi), velocity: 0.38 }]
      },
      {
        voice: "bass",
        notes: [{ ...held, freq: midiToFrequency(rootMidi - OCTAVE), velocity: 0.45 }]
      },
      {
        voice: "pad",
        // Root position: the plainest possible statement of the chord, which is what
        // an ending wants — the pad spends the whole piece avoiding it.
        notes: tonic.pcs.map((pc) => ({
          ...held,
          freq: midiToFrequency(rootMidi + tonic.root + (pc - tonic.root + OCTAVE) % OCTAVE),
          velocity: 0.26
        }))
      }
    ],
    drums: []
  };
}

// src/compose/humanize.ts
var DEFAULT_TIMING = 0.02;
var DEFAULT_VELOCITY = 0.06;
function humanize(score, rng, options = {}) {
  const maxTiming = options.timing ?? DEFAULT_TIMING;
  const maxVelocity = options.velocity ?? DEFAULT_VELOCITY;
  const nudge = (max) => (rng.next() * 2 - 1) * max;
  const len = score.lengthBeats;
  const shift = (startBeat, durationBeats) => {
    const start = Math.min(len - 1e-6, Math.max(0, startBeat + nudge(maxTiming)));
    return { startBeat: start, durationBeats: Math.min(durationBeats, len - start) };
  };
  const swingVelocity = (velocity) => Math.min(1, Math.max(0.01, velocity * (1 + nudge(maxVelocity))));
  const parts = score.parts.map((part) => ({
    voice: part.voice,
    notes: part.notes.map((n) => ({
      // Keep every field (freq and the slide/shake gamaka) and nudge only what humanizes:
      // timing and velocity. Rebuilding the note from scratch would silently drop ornaments.
      ...n,
      ...shift(n.startBeat, n.durationBeats),
      velocity: swingVelocity(n.velocity)
    }))
  }));
  const drums = score.drums.map((h) => ({
    startBeat: Math.min(len - 1e-6, Math.max(0, h.startBeat + nudge(maxTiming))),
    drum: h.drum,
    velocity: swingVelocity(h.velocity)
  }));
  return { ...score, parts, drums };
}

// src/session.ts
var STREAM_EPOCH = 1;
var SLIDE_MIN_SUSTAIN = 0.25;
function randomSeed() {
  const webCrypto = globalThis.crypto;
  if (webCrypto?.getRandomValues) {
    return webCrypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Date.now() >>> 0;
}
function pickInstrument(rng, pool) {
  return INSTRUMENTS[rng.pick(pool)];
}
function mergeVoices(section, user) {
  const out = { ...section };
  if (user) {
    for (const key of Object.keys(user)) {
      if (user[key] === false) out[key] = false;
    }
  }
  return out;
}
function createSession(options) {
  const master = makeRng(options.seed ?? randomSeed());
  const styleRng = master.fork();
  const instrumentRng = master.fork();
  const arrangeRng = master.fork();
  const noiseRng = master.fork();
  const chosen = pickStyle(styleRng, options.style);
  const bpm = options.bpm ?? chosen.bpm;
  if (!(bpm > 0) || !Number.isFinite(bpm)) {
    throw new RangeError(`createSession: bpm must be a positive number, got ${bpm}`);
  }
  const bars = options.bars ?? 8;
  const evolve = options.evolve ?? true;
  const instruments = {
    lead: pickInstrument(instrumentRng, chosen.instruments.lead),
    bass: pickInstrument(instrumentRng, chosen.instruments.bass),
    pad: pickInstrument(instrumentRng, chosen.instruments.pad),
    arp: pickInstrument(instrumentRng, chosen.instruments.arp)
  };
  const kitName = options.kit ?? "default";
  if (!(kitName in DRUM_KITS)) {
    throw new RangeError(`createSession: unknown drum kit "${kitName}"`);
  }
  const drumKit = DRUM_KITS[kitName];
  const noiseTable = makeNoiseTable(noiseRng);
  const parent = options.parent ?? chosen.parent;
  const raga = options.raga ?? chosen.raga;
  const paths = options.paths ?? (options.raga ? void 0 : chosen.paths);
  const carnatic = options.carnatic ?? (options.raga ? true : chosen.carnatic ?? true);
  const sevenths = options.sevenths ?? chosen.sevenths;
  const rootMidi = options.rootMidi ?? chosen.rootMidi;
  const groove = options.groove ?? chosen.groove;
  const density = options.density ?? chosen.density;
  const swing = options.swing ?? chosen.swing;
  assertMusicalParams({ swing, density, rootMidi, groove, parent, raga });
  const beatsPerBar = options.beatsPerBar ?? DRUM_GROOVES[groove].beatsPerBar;
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1) {
    throw new RangeError(`createSession: beatsPerBar must be an integer >= 1, got ${beatsPerBar}`);
  }
  if (!Number.isInteger(bars) || bars < 4) {
    throw new RangeError(`createSession: bars must be an integer >= 4, got ${bars}`);
  }
  const form = buildForm({
    rng: arrangeRng.fork(),
    scale: parent,
    raga,
    ...paths !== void 0 ? { paths } : {},
    rootMidi,
    bars,
    beatsPerBar,
    density,
    groove,
    borrow: options.chromatic ?? true,
    secondaryDominants: options.secondaryDominants ?? options.chromatic ?? true,
    ...sevenths !== void 0 ? { sevenths } : {},
    ...options.form !== void 0 ? { form: options.form } : {},
    ...options.intro !== void 0 ? { intro: options.intro } : {}
  });
  const humanizeOn = options.humanize ?? true;
  const humanizeRng = arrangeRng.fork();
  const arrangeSection = (section) => {
    const score = arrange({
      rng: arrangeRng,
      bpm: Math.round(bpm * section.bpmScale),
      // per-section tempo (B pulls back, C pushes)
      beatsPerBar,
      bars: section.bars,
      // sections run to their own length
      parent,
      raga,
      ...paths !== void 0 ? { paths } : {},
      rootMidi: section.rootMidi,
      // may modulate per section (key change)
      groove: section.groove,
      // B sparser, C busier than home
      density: section.density,
      swing,
      plan: section.plan,
      texture: section.texture,
      bassPattern: section.bassPattern,
      contour: options.contour ?? section.contour,
      // caller can pin one shape for the whole piece
      // Only a voice that holds its note can slide onto one; a struck bar has decayed
      // before the slide would land.
      slide: (options.slide ?? true) && instruments.lead.amp.sustain >= SLIDE_MIN_SUSTAIN,
      // Same physics as the slide (a struck bar has decayed before an oscillation could
      // be heard), and kampita only on an actual raga — a plain pentatonic has no swaras
      // to shake toward.
      shake: (options.shake ?? true) && carnatic && instruments.lead.amp.sustain >= SLIDE_MIN_SUSTAIN,
      leadRange: section.range,
      // the part's register — a kriti's anupallavi sings an octave up
      dynamics: section.dynamics,
      fill: section.fill,
      arpRole: options.arpRole ?? section.arpRole,
      // arp arpeggiates / harmonises / doubles / counters the theme
      padPattern: section.padPattern,
      // pad: sustain (A) / broken (B) / stabs (C)
      motif: form.motif,
      // the recurring theme, stated at the head of every section
      motifBars: form.motifBars,
      development: section.development,
      // A states the theme, B develops it, C intensifies it
      voices: mergeVoices(section.voices, options.voices)
      // section enter/leave ∧ caller toggles
    });
    return humanizeOn ? humanize(score, humanizeRng) : score;
  };
  const view = (s) => ({
    label: s.label,
    keyShift: s.rootMidi - rootMidi,
    arpRole: s.arpRole,
    development: s.development,
    part: s.part,
    bars: s.bars,
    bpm: Math.round(bpm * s.bpmScale)
  });
  const sections = (form.intro ? [form.intro, ...form.sections] : form.sections).map(view);
  const played = form.intro ? [form.intro, ...form.sections] : [...form.sections];
  const loopFrom = form.intro ? 1 : 0;
  let cursor = 0;
  const cache = played.map(() => null);
  return {
    noiseTable,
    bpm,
    beatsPerBar,
    bars,
    instruments,
    drumKit,
    formKind: form.kind,
    loopFrom,
    sections,
    closingScore() {
      return closingScore({ parent, raga, rootMidi, bpm, beatsPerBar });
    },
    nextScore() {
      const i = cursor < played.length ? cursor : loopFrom + (cursor - loopFrom) % (played.length - loopFrom);
      cursor += 1;
      if (evolve) return arrangeSection(played[i]);
      const cached = cache[i];
      if (cached) return cached;
      const score = arrangeSection(played[i]);
      cache[i] = score;
      return score;
    }
  };
}

export { CHORD_QUALITIES, DEFAULT_MAX_LEAP, DEFAULT_MAX_NOTE_REPEAT, DEFAULT_NOISE_LENGTH, DEFAULT_ROOT_MIDI, DRUM_GROOVES, DRUM_KITS, FUNCTION_OF, INSTRUMENTS, MIX_BY_VOICE, MOTIF_TRANSFORMS, OCTAVE, PAN_BY_VOICE, PLAIN_STATEMENT, PROGRESSIONS, RAGA_PATHS, REVERB_SEND_BY_VOICE, SCALES, STEPS_PER_BEAT, STREAM_EPOCH, STYLES, SWING_MAX, ShuffleBag, applySwing, arrange, capLeap, chordAt, chordPitchClasses, chordQualityOf, chordTonesInScale, clampSafe, contourTarget, createSession, degreePitchClass, degreeToFrequency, degreeToSemitone, developMotif, diatonicChord, encodeWav, exceedsRepeatLimit, fitGroove, functionalProgression, generateHarmony, generateMelody, instrumentsForVoice, isChordTone, isWithinLeap, makeChord, makeNoiseTable, makeRng, melodyRhythm, metricStrength, midiToFrequency, pickStyle, romanNumerals, semitoneToFrequency, tuneKit };
//# sourceMappingURL=chunk-QXUAM566.js.map
//# sourceMappingURL=chunk-QXUAM566.js.map