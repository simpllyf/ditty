import { describe, expect, it } from "vitest";
import { makeRng } from "../src/rng";

/** Drain `count` floats from a fresh Rng seeded with `seed`. */
function sample(seed: number, count: number): number[] {
  const rng = makeRng(seed);
  return Array.from({ length: count }, () => rng.next());
}

describe("makeRng — determinism", () => {
  it("produces an identical sequence for the same seed", () => {
    expect(sample(12345, 32)).toEqual(sample(12345, 32));
  });

  it("produces different sequences for different seeds", () => {
    expect(sample(1, 16)).not.toEqual(sample(2, 16));
  });

  it("coerces the seed to uint32, so equivalent seeds match", () => {
    // 0 and 2^32 are the same 32-bit state.
    expect(sample(0, 8)).toEqual(sample(0x1_0000_0000, 8));
  });

  it("coerces negative seeds the same way (>>> 0)", () => {
    // -1 >>> 0 === 0xFFFFFFFF; hashed/derived seeds are often negative.
    expect(sample(-1, 8)).toEqual(sample(0xffffffff, 8));
  });

  it("survives a known-answer snapshot (guards the algorithm byte-for-byte)", () => {
    // Locks mulberry32(42) over a sequence. toEqual is exact for numbers, so any
    // drift in either the PRNG math or its state evolution is a breaking change.
    expect(sample(42, 8)).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693,
      0.17481389874592423, 0.5265925421845168, 0.2732279943302274, 0.6247446539346129,
    ]);
  });
});

describe("makeRng — next()", () => {
  it("stays within [0, 1)", () => {
    const rng = makeRng(7);
    for (let i = 0; i < 10_000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("makeRng — int()", () => {
  it("stays within [0, maxExclusive)", () => {
    const rng = makeRng(99);
    for (let i = 0; i < 10_000; i++) {
      const value = rng.int(6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
    }
  });

  it("covers the whole range over many draws", () => {
    const rng = makeRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      seen.add(rng.int(6));
    }
    expect(seen).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });

  it("int(1) always returns 0", () => {
    const rng = makeRng(3);
    for (let i = 0; i < 100; i++) {
      expect(rng.int(1)).toBe(0);
    }
  });

  it.each([0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "throws for an invalid maxExclusive (%s)",
    (bad) => {
      expect(() => makeRng(1).int(bad)).toThrow(RangeError);
    },
  );
});

describe("makeRng — pick()", () => {
  it("returns an element from the array, deterministically", () => {
    const items = ["a", "b", "c", "d"] as const;
    const a = makeRng(55);
    const b = makeRng(55);
    for (let i = 0; i < 50; i++) {
      const choice = a.pick(items);
      expect(items).toContain(choice);
      expect(choice).toBe(b.pick(items));
    }
  });

  it("throws on an empty array", () => {
    expect(() => makeRng(1).pick([])).toThrow(RangeError);
  });
});

describe("makeRng — weighted()", () => {
  it("only ever returns items whose weight is positive", () => {
    const rng = makeRng(11);
    const items = ["x", "y", "z"] as const;
    const weights = [1, 0, 3];
    for (let i = 0; i < 1000; i++) {
      expect(rng.weighted(items, weights)).not.toBe("y");
    }
  });

  it("a single non-zero weight is always chosen", () => {
    const rng = makeRng(11);
    for (let i = 0; i < 100; i++) {
      expect(rng.weighted(["only", "never"], [0, 5])).toBe("never");
    }
  });

  it("approximates the weight distribution over many draws", () => {
    const rng = makeRng(2024);
    const items = ["a", "b"] as const;
    const weights = [3, 1]; // expect ~75% / ~25%
    const counts = { a: 0, b: 0 };
    const draws = 40_000;
    for (let i = 0; i < draws; i++) {
      counts[rng.weighted(items, weights)]++;
    }
    expect(counts.a / draws).toBeCloseTo(0.75, 1);
  });

  it("throws on length mismatch, empty input, non-positive total, or non-finite weight", () => {
    const rng = makeRng(1);
    expect(() => rng.weighted(["a", "b"], [1])).toThrow(RangeError);
    expect(() => rng.weighted([], [])).toThrow(RangeError);
    expect(() => rng.weighted(["a", "b"], [0, 0])).toThrow(RangeError);
    expect(() => rng.weighted(["a", "b"], [1, -1])).toThrow(RangeError);
    // The guard is `!(weight >= 0)` precisely so NaN is rejected; a naive
    // `weight < 0` would let NaN through and silently corrupt the selection.
    expect(() => rng.weighted(["a", "b"], [1, Number.NaN])).toThrow(RangeError);
  });

  it("never selects a zero-weight item, across many seeds and weight shapes", () => {
    // Locks the core invariant and exercises the floating-point tail fallback
    // (which only fires when a draw lands extremely close to the total).
    const items = ["a", "b", "c", "d"] as const;
    const shapes = [
      [5, 0, 0, 0],
      [1, 0, 3, 0],
      [0, 0, 0, 7],
      [2, 2, 0, 2],
      [1, 1, 1, 1],
    ];
    for (let seed = 0; seed < 200; seed++) {
      const rng = makeRng(seed);
      for (const weights of shapes) {
        for (let i = 0; i < 50; i++) {
          const choice = rng.weighted(items, weights);
          expect(weights[items.indexOf(choice)]!).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("makeRng — fork()", () => {
  it("is deterministic: same parent seed yields the same child stream", () => {
    const childA = makeRng(8).fork();
    const childB = makeRng(8).fork();
    expect(Array.from({ length: 16 }, () => childA.next())).toEqual(
      Array.from({ length: 16 }, () => childB.next()),
    );
  });

  it("consumes exactly one step of the parent stream", () => {
    // The contract: fork() advances the parent by one draw, no more. A regression
    // that consumed two steps would still pass every other fork test here, yet
    // silently shift every downstream parent draw — breaking reproducibility.
    const parent = makeRng(55);
    parent.fork();
    expect(parent.next()).toBe(sample(55, 2)[1]);
  });

  it("successive forks are independent of each other", () => {
    const parent = makeRng(8);
    const first = parent.fork();
    const second = parent.fork();
    const a = Array.from({ length: 16 }, () => first.next());
    const b = Array.from({ length: 16 }, () => second.next());
    expect(a).not.toEqual(b);
  });

  it("a child does not simply echo its parent's stream", () => {
    const parent = makeRng(123);
    const child = parent.fork();
    const childSeq = Array.from({ length: 16 }, () => child.next());
    const parentSeq = Array.from({ length: 16 }, () => parent.next());
    expect(childSeq).not.toEqual(parentSeq);
  });

  it("forked streams are statistically uncorrelated", () => {
    const parent = makeRng(777);
    const a = parent.fork();
    const b = parent.fork();
    const n = 20_000;
    let sumA = 0;
    let sumB = 0;
    let sumAB = 0;
    let sumAA = 0;
    let sumBB = 0;
    for (let i = 0; i < n; i++) {
      const x = a.next();
      const y = b.next();
      sumA += x;
      sumB += y;
      sumAB += x * y;
      sumAA += x * x;
      sumBB += y * y;
    }
    const cov = sumAB / n - (sumA / n) * (sumB / n);
    const varA = sumAA / n - (sumA / n) ** 2;
    const varB = sumBB / n - (sumB / n) ** 2;
    const corr = cov / Math.sqrt(varA * varB);
    expect(Math.abs(corr)).toBeLessThan(0.05);
  });
});

describe("makeRng — distribution sanity", () => {
  it("next() has a mean near 0.5", () => {
    const rng = makeRng(31337);
    const n = 100_000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += rng.next();
    }
    expect(sum / n).toBeCloseTo(0.5, 2);
  });

  it("next() fills its buckets roughly uniformly", () => {
    const rng = makeRng(31337);
    const buckets = 10;
    const counts = new Array<number>(buckets).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      counts[Math.min(buckets - 1, Math.floor(rng.next() * buckets))]!++;
    }
    const expected = n / buckets;
    for (const count of counts) {
      // No bucket should stray more than ~15% from uniform.
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.15);
    }
  });
});
