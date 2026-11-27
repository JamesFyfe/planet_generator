import { describe, expect, it } from "vitest";
import { createPrng, normalizeSeed } from "./index";

function take(seed: number, count: number): number[] {
  const rng = createPrng(seed);
  return Array.from({ length: count }, () => rng.next());
}

describe("normalizeSeed", () => {
  it("maps finite numbers into uint32 space", () => {
    expect(normalizeSeed(1.9)).toBe(1);
    expect(normalizeSeed(-1)).toBe(0xffffffff);
    expect(normalizeSeed(Number.NaN)).toBe(0);
    expect(normalizeSeed(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("createPrng", () => {
  it("repeats the same sequence for the same seed", () => {
    expect(take(1, 16)).toEqual(take(1, 16));
    expect(take(1, 4)).toMatchInlineSnapshot(`
      [
        0.6270739405881613,
        0.002735721180215478,
        0.5274470399599522,
        0.9810509674716741,
      ]
    `);
  });

  it("produces a different sequence for a different seed", () => {
    expect(take(1, 8)).not.toEqual(take(2, 8));
  });

  it("keeps independent streams from interfering", () => {
    const first = createPrng(7);
    const second = createPrng(7);
    first.next();
    expect(second.next()).toBe(take(7, 1)[0]);
  });

  it("stays inside [0, 1)", () => {
    for (const value of take(5, 1_000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("returns integers in range from nextInt", () => {
    const rng = createPrng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const value = rng.nextInt(7);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
      seen.add(value);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("returns floats in range from nextFloat", () => {
    const rng = createPrng(9);
    for (let i = 0; i < 200; i++) {
      const value = rng.nextFloat(-2, 5);
      expect(value).toBeGreaterThanOrEqual(-2);
      expect(value).toBeLessThan(5);
    }
  });

  it("rejects empty integer ranges and inverted float ranges", () => {
    const rng = createPrng(1);
    expect(() => rng.nextInt(0)).toThrow(/positive integer/);
    expect(() => rng.nextInt(1.5)).toThrow(/positive integer/);
    expect(() => rng.nextFloat(3, 3)).toThrow(/max > min/);
  });
});
