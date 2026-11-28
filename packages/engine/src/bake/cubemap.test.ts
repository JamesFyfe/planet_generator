import { describe, expect, it } from "vitest";
import { cubeFaceUv } from "../cubeSphere";
import type { Vec3 } from "../noise/domainWarp";
import { BAKE_RESOLUTION, fillCubemaps, sampleCubemap, sampleCubemapFace } from "./cubemap";
import type { Cubemap } from "./cubemap";

function analytic(resolution: number): Cubemap {
  const set = fillCubemaps(resolution, [{ id: "y", filter: "bilinear" }], (dir, out) => {
    out[0] = dir.y;
  });
  const map = set.maps[0];
  if (!map) throw new Error("missing analytic map");
  return map;
}

function edgePairs(): Array<{ point: Vec3; left: number; right: number }> {
  const pairs: Array<{ point: Vec3; left: number; right: number }> = [];
  const samples = [-0.65, -0.2, 0.15, 0.7];
  for (const t of samples) {
    pairs.push(
      { point: { x: 1, y: 1, z: t }, left: 0, right: 2 },
      { point: { x: 1, y: -1, z: t }, left: 0, right: 3 },
      { point: { x: 1, y: t, z: 1 }, left: 0, right: 4 },
      { point: { x: 1, y: t, z: -1 }, left: 0, right: 5 },
      { point: { x: -1, y: 1, z: t }, left: 1, right: 2 },
      { point: { x: -1, y: t, z: 1 }, left: 1, right: 4 },
      { point: { x: t, y: 1, z: 1 }, left: 2, right: 4 },
      { point: { x: t, y: -1, z: 1 }, left: 3, right: 4 },
    );
  }
  return pairs;
}

describe("cubemap lookup", () => {
  it("is continuous across cube edges", () => {
    for (const resolution of [32, BAKE_RESOLUTION]) {
      const map = analytic(resolution);
      for (const { point, left, right } of edgePairs()) {
        const leftUv = cubeFaceUv(left, point);
        const rightUv = cubeFaceUv(right, point);
        const a = sampleCubemapFace(map, left, leftUv.u, leftUv.v, "bilinear");
        const b = sampleCubemapFace(map, right, rightUv.u, rightUv.v, "bilinear");
        expect(a).toBeCloseTo(b, 5);
      }
    }
  });

  it("stays close to the analytic field on either side of an edge", () => {
    const map = analytic(64);
    const delta = 1e-3;
    for (const { point, left, right } of edgePairs()) {
      const leftDir = ontoFace(point, left, delta);
      const rightDir = ontoFace(point, right, delta);
      const leftSample = sampleCubemap(map, leftDir, "bilinear");
      const rightSample = sampleCubemap(map, rightDir, "bilinear");
      expect(Math.abs(leftSample - rightSample)).toBeLessThan(0.02);
      const leftLen = Math.hypot(leftDir.x, leftDir.y, leftDir.z);
      expect(leftSample).toBeCloseTo(leftDir.y / leftLen, 1);
    }
  });

  it("returns the texel value at its center", () => {
    const resolution = 8;
    const set = fillCubemaps(resolution, [{ id: "id", filter: "nearest" }], (dir, out) => {
      out[0] = dir.x * 10 + dir.y;
    });
    const map = set.maps[0];
    if (!map) throw new Error("missing map");
    const i = 3;
    const j = 5;
    const u = ((i + 0.5) / resolution) * 2 - 1;
    const v = ((j + 0.5) / resolution) * 2 - 1;
    const stored = map.data[(0 * resolution + j) * resolution + i] ?? 0;
    expect(sampleCubemapFace(map, 0, u, v, "nearest")).toBeCloseTo(stored, 5);
    expect(sampleCubemapFace(map, 0, u, v, "bilinear")).toBeCloseTo(stored, 5);
  });
});

/** Pull the other axes in so `face` owns the point, just off the shared edge. */
function ontoFace(point: Vec3, face: number, delta: number): Vec3 {
  const next = { ...point };
  const axis = face <= 1 ? "x" : face <= 3 ? "y" : "z";
  const keys = ["x", "y", "z"] as const;
  for (const key of keys) {
    if (key === axis) continue;
    if (Math.abs(next[key]) >= 1 - 1e-6) next[key] -= Math.sign(next[key]) * delta;
  }
  return next;
}
