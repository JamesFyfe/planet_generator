import { describe, expect, it } from "vitest";
import { buildWaterGeometry } from "./water";

function lengthOf(x: number, y: number, z: number): number {
  return Math.hypot(x, y, z);
}

describe("water geometry", () => {
  it("stays chunk-local and sits on the sea-level sphere", () => {
    const radius = 50_000;
    const seaLevel = 120;
    const grid = 3;
    const origin = { x: radius, y: 0, z: 0 };
    const positions = new Float32Array(grid * grid * 3);
    const seaRelativeHeight = new Float32Array(grid * grid);
    for (let j = 0; j < grid; j++) {
      for (let i = 0; i < grid; i++) {
        const index = j * grid + i;
        const localX = (i - 1) * 30;
        const localY = -40;
        const localZ = (j - 1) * 25;
        positions[index * 3] = localX;
        positions[index * 3 + 1] = localY;
        positions[index * 3 + 2] = localZ;
        const radial = lengthOf(origin.x + localX, origin.y + localY, origin.z + localZ);
        seaRelativeHeight[index] = radial - radius - seaLevel;
      }
    }
    const water = buildWaterGeometry({
      positions,
      seaRelativeHeight,
      origin,
      gridSize: grid,
      planetRadius: radius,
      seaLevel,
    });
    expect(water).not.toBeNull();
    if (!water) return;
    const seaRadius = radius + seaLevel;
    let onSurface = 0;
    for (let index = 0; index < water.depth.length; index++) {
      const offset = index * 3;
      const localX = water.positions[offset] ?? 0;
      const localY = water.positions[offset + 1] ?? 0;
      const localZ = water.positions[offset + 2] ?? 0;
      const radial = lengthOf(localX + origin.x, localY + origin.y, localZ + origin.z);
      expect(lengthOf(localX, localY, localZ)).toBeLessThan(500);
      expect(radial).toBeLessThanOrEqual(seaRadius + 0.05);
      expect(radial).toBeGreaterThan(seaRadius - 2);
      if (Math.abs(radial - seaRadius) < 0.05) onSurface += 1;
    }
    expect(onSurface).toBeGreaterThanOrEqual(grid * grid);
  });

  it("skips a chunk that is entirely above sea level", () => {
    const grid = 2;
    const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 10, 10, 0, 10]);
    const seaRelativeHeight = new Float32Array([80, 90, 70, 100]);
    expect(
      buildWaterGeometry({
        positions,
        seaRelativeHeight,
        origin: { x: 50_000, y: 0, z: 0 },
        gridSize: grid,
        planetRadius: 50_000,
        seaLevel: 0,
      }),
    ).toBeNull();
  });

  it("keeps a shoreline quad and is deterministic", () => {
    const grid = 2;
    const positions = new Float32Array(12);
    const seaRelativeHeight = new Float32Array([-30, 40, 20, 15]);
    const input = {
      positions,
      seaRelativeHeight,
      origin: { x: 10_000, y: 0, z: 0 },
      gridSize: grid,
      planetRadius: 10_000,
      seaLevel: 0,
    };
    const first = buildWaterGeometry(input);
    const second = buildWaterGeometry(input);
    expect(first).not.toBeNull();
    expect(second?.indices).toEqual(first?.indices);
    expect(second?.positions).toEqual(first?.positions);
    expect(first && Math.max(...first.depth)).toBeGreaterThan(0);
    expect(first && Math.min(...first.depth)).toBeLessThan(0);
  });
});
