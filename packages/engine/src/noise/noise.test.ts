import { describe, expect, it } from "vitest";
import { billow, domainWarp, fbm, ridgedMultifractal, simplex3, worley } from "../index";

function sampleGrid(): Array<[number, number, number]> {
  const points: Array<[number, number, number]> = [];
  for (let i = 0; i <= 12; i++) {
    for (let j = 0; j <= 12; j++) {
      for (let k = 0; k <= 12; k++) {
        points.push([i / 12, j / 12, k / 12]);
        points.push([-i / 10, j / 7, -k / 9]);
      }
    }
  }
  points.push([12.5, -8.25, 3.125], [80, 0.5, -40], [0, 0, 0]);
  return points;
}

const GRID = sampleGrid();

function expectUnitInterval(value: number): void {
  expect(Number.isFinite(value)).toBe(true);
  expect(value).toBeGreaterThanOrEqual(-1);
  expect(value).toBeLessThanOrEqual(1);
}

describe("simplex3", () => {
  it("is deterministic for a seed and does not depend on call order", () => {
    const first = GRID.map(([x, y, z]) => simplex3(4, x, y, z));
    simplex3(99, 10, -4, 2);
    const second = GRID.map(([x, y, z]) => simplex3(4, x, y, z));
    expect(second).toEqual(first);
    expect(simplex3(1, 0.1, 0.2, 0.3)).toMatchInlineSnapshot(`0.16953224533333328`);
  });

  it("changes when the seed changes", () => {
    const a = GRID.map(([x, y, z]) => simplex3(1, x, y, z));
    const b = GRID.map(([x, y, z]) => simplex3(2, x, y, z));
    expect(a).not.toEqual(b);
  });

  it("coerces the seed the same way as the PRNG", () => {
    expect(simplex3(1.9, 0.2, 0.4, 0.6)).toBe(simplex3(1, 0.2, 0.4, 0.6));
    expect(simplex3(-3, 0.2, 0.4, 0.6)).toBe(simplex3(-3, 0.2, 0.4, 0.6));
    expect(simplex3(-3, 0.2, 0.4, 0.6)).not.toBe(simplex3(3, 0.2, 0.4, 0.6));
  });

  it("stays inside [-1, 1] and varies across a grid", () => {
    const values = GRID.map(([x, y, z]) => simplex3(3, x, y, z));
    for (const value of values) expectUnitInterval(value);
    expect(new Set(values.map((value) => value.toFixed(5))).size).toBeGreaterThan(20);
  });

  it("is continuous between nearby samples", () => {
    const origin = simplex3(1, 0.2, 0.3, 0.4);
    const neighbor = simplex3(1, 0.21, 0.3, 0.4);
    expect(Math.abs(origin - neighbor)).toBeLessThan(0.2);
    expect(origin).not.toBe(neighbor);
  });
});

describe("fractal helpers", () => {
  it("matches one-octave definitions", () => {
    const noise = simplex3(8, 0.2, 0.3, 0.4);
    expect(fbm(8, 0.2, 0.3, 0.4, { octaves: 1 })).toBe(noise);
    expect(fbm(8, 0.2, 0.3, 0.4, { octaves: 1, frequency: 2 })).toBe(simplex3(8, 0.4, 0.6, 0.8));
    expect(billow(8, 0.2, 0.3, 0.4, { octaves: 1 })).toBe(Math.abs(noise) * 2 - 1);
    expect(ridgedMultifractal(8, 0.2, 0.3, 0.4, { octaves: 1 })).toBe((1 - Math.abs(noise)) ** 2);
  });

  it("is deterministic and seed-dependent", () => {
    expect(fbm(1, 0.1, 0.2, 0.3)).toBe(fbm(1, 0.1, 0.2, 0.3));
    expect(fbm(1, 0.1, 0.2, 0.3)).not.toBe(fbm(2, 0.1, 0.2, 0.3));
    expect(billow(1, 0.1, 0.2, 0.3)).toBe(billow(1, 0.1, 0.2, 0.3));
    expect(billow(1, 0.1, 0.2, 0.3)).not.toBe(billow(2, 0.1, 0.2, 0.3));
    expect(ridgedMultifractal(1, 0.1, 0.2, 0.3)).toBe(ridgedMultifractal(1, 0.1, 0.2, 0.3));
    expect(ridgedMultifractal(1, 0.1, 0.2, 0.3)).not.toBe(ridgedMultifractal(2, 0.1, 0.2, 0.3));
    expect(fbm(1, 0.1, 0.2, 0.3)).toMatchInlineSnapshot(`-0.19107624391111108`);
    expect(billow(1, 0.1, 0.2, 0.3)).toMatchInlineSnapshot(`-0.25617872213333354`);
    expect(ridgedMultifractal(1, 0.1, 0.2, 0.3)).toMatchInlineSnapshot(`0.3820843390792192`);
  });

  it("stays in range across the sample grid", () => {
    for (const [x, y, z] of GRID) {
      expectUnitInterval(fbm(6, x, y, z));
      expectUnitInterval(billow(6, x, y, z));
      const ridged = ridgedMultifractal(6, x, y, z);
      expect(Number.isFinite(ridged)).toBe(true);
      expect(ridged).toBeGreaterThanOrEqual(0);
      expect(ridged).toBeLessThanOrEqual(1);
    }
  });

  it("uses later octaves", () => {
    expect(fbm(1, 0.2, 0.3, 0.4, { octaves: 1 })).not.toBe(fbm(1, 0.2, 0.3, 0.4, { octaves: 4 }));
  });

  it("rejects octave and frequency settings that would not terminate", () => {
    expect(() => fbm(1, 0, 0, 0, { octaves: 0 })).toThrow(/octaves/);
    expect(() => billow(1, 0, 0, 0, { frequency: 0 })).toThrow(/frequency/);
    expect(() => ridgedMultifractal(1, 0, 0, 0, { lacunarity: -1 })).toThrow(/lacunarity/);
  });
});

describe("domainWarp", () => {
  it("is identity at zero amplitude and bounded otherwise", () => {
    expect(domainWarp(1, 0.3, 0.4, 0.5, { amplitude: 0 })).toEqual({ x: 0.3, y: 0.4, z: 0.5 });
    const warped = domainWarp(1, 0.3, 0.4, 0.5, { amplitude: 2, frequency: 1.5 });
    expect(warped).toEqual(domainWarp(1, 0.3, 0.4, 0.5, { amplitude: 2, frequency: 1.5 }));
    expect(warped).not.toEqual(domainWarp(2, 0.3, 0.4, 0.5, { amplitude: 2, frequency: 1.5 }));
    expect(Math.abs(warped.x - 0.3)).toBeLessThanOrEqual(2);
    expect(Math.abs(warped.y - 0.4)).toBeLessThanOrEqual(2);
    expect(Math.abs(warped.z - 0.5)).toBeLessThanOrEqual(2);
    expect(warped).not.toEqual({ x: 0.3, y: 0.4, z: 0.5 });
    expect(domainWarp(1, 0.1, 0.2, 0.3)).toMatchInlineSnapshot(`
      {
        "x": 0.2695322453333333,
        "y": 0.8355503786666665,
        "z": 0.19000835200000002,
      }
    `);
  });

  it("rejects a negative amplitude", () => {
    expect(() => domainWarp(1, 0, 0, 0, { amplitude: -1 })).toThrow(/amplitude/);
  });
});

describe("worley", () => {
  it("is deterministic and seed-dependent", () => {
    expect(worley(1, 0.2, 0.4, 0.6)).toEqual(worley(1, 0.2, 0.4, 0.6));
    expect(worley(1, 0.2, 0.4, 0.6)).not.toEqual(worley(2, 0.2, 0.4, 0.6));
    expect(worley(1, 0.1, 0.2, 0.3)).toMatchInlineSnapshot(`
      {
        "f1": 0.41365112125908826,
        "f2": 0.4330026432620913,
      }
    `);
  });

  it("keeps F1 and F2 in the 3x3x3 neighborhood bound", () => {
    for (const [x, y, z] of GRID) {
      const { f1, f2 } = worley(11, x, y, z);
      expect(f1).toBeGreaterThanOrEqual(0);
      expect(f1).toBeLessThan(Math.sqrt(3));
      expect(f2).toBeGreaterThanOrEqual(f1);
      expect(f2).toBeLessThan(4);
      expect(Number.isFinite(f1)).toBe(true);
      expect(Number.isFinite(f2)).toBe(true);
    }
  });
});
