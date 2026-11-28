import { describe, expect, it } from "vitest";
import { CHUNK_GRID_SIZE, chunkPatch } from "./chunk";
import { cubeFacePoint, cubeFaceUv, spherifyCube } from "./cubeSphere";
import { adjacentChunk } from "./lod";
import { createPlanet, defaultPlanetParams, type ChunkData, type ChunkRequest } from "./index";
import type { PlanetParams } from "./params";
import { dot, length, sub } from "./vec3";

function withParams(overrides: Partial<PlanetParams>): PlanetParams {
  return { ...defaultPlanetParams(), ...overrides };
}

function fastPlanet(seed = 1) {
  return createPlanet(
    withParams({
      seed,
      amplitude: 1_000,
      continentOctaves: 1,
      mountainOctaves: 1,
      hillOctaves: 1,
      detailOctaves: 1,
      mountainStrength: 0,
      hillStrength: 0,
      detailStrength: 0,
      warpStrength: 0,
    }),
  );
}

function worldAt(chunk: ChunkData, index: number) {
  const offset = index * 3;
  return {
    x: chunk.origin.x + (chunk.positions[offset] ?? 0),
    y: chunk.origin.y + (chunk.positions[offset + 1] ?? 0),
    z: chunk.origin.z + (chunk.positions[offset + 2] ?? 0),
  };
}

function surfaceIndex(i: number, j: number): number {
  return j * CHUNK_GRID_SIZE + i;
}

describe("buildChunk", () => {
  const request: ChunkRequest = { face: 0, lod: 1, x: 1, y: 0 };

  it("is a pure function of params and the request", () => {
    const planet = fastPlanet();
    const first = planet.buildChunk(request);
    const other = fastPlanet(2).buildChunk({ face: 3, lod: 0, x: 0, y: 0 });
    const second = planet.buildChunk(request);
    expect(second.positions).toEqual(first.positions);
    expect(second.normals).toEqual(first.normals);
    expect(second.height).toEqual(first.height);
    expect(second.indices).toEqual(first.indices);
    expect(second.origin).toEqual(first.origin);
    expect(other.positions).not.toEqual(first.positions);
    expect(fastPlanet(2).buildChunk(request).height).not.toEqual(first.height);
  });

  it("stores chunk-local meters around the center vertex", () => {
    const planet = fastPlanet();
    const chunk = planet.buildChunk(request);
    const grid = CHUNK_GRID_SIZE;
    const surfaceCount = grid * grid;
    const center = surfaceIndex((grid - 1) / 2, (grid - 1) / 2);
    expect(chunk.positions[center * 3]).toBeCloseTo(0, 4);
    expect(chunk.positions[center * 3 + 1]).toBeCloseTo(0, 4);
    expect(chunk.positions[center * 3 + 2]).toBeCloseTo(0, 4);

    const radial = length(chunk.origin);
    expect(radial).toBeGreaterThan(planet.params.radius * 0.5);
    expect(radial).toBeLessThan(planet.params.radius * 1.5);
    const corner = worldAt(chunk, 0);
    const cornerRadius = length(corner);
    expect(cornerRadius).toBeCloseTo(planet.params.radius + (chunk.height[0] ?? 0), 0);

    let maxAbs = 0;
    for (const value of chunk.positions) maxAbs = Math.max(maxAbs, Math.abs(value));
    // Lod 1 is a quarter of a face, so local offsets stay well below the planet diameter.
    expect(maxAbs).toBeLessThan(planet.params.radius);
    expect(chunk.positions.length).toBe((surfaceCount + grid * 4) * 3);
    expect(chunk.normals.length).toBe(chunk.positions.length);
    expect(chunk.height.length).toBe(surfaceCount + grid * 4);
    expect(chunk.boundingRadius).toBeGreaterThan(0);
    expect(chunk.boundingRadius).toBeLessThan(planet.params.radius);
  });

  it("keeps high-lod offsets small enough for float32", () => {
    const planet = fastPlanet();
    const tiles = 2 ** 8;
    const chunk = planet.buildChunk({ face: 2, lod: 8, x: tiles / 2, y: tiles / 2 });
    let maxAbs = 0;
    for (const value of chunk.positions) maxAbs = Math.max(maxAbs, Math.abs(value));
    expect(maxAbs).toBeLessThan(1_000);
  });

  it("points normals outward and drops skirts toward the center", () => {
    const planet = createPlanet(withParams({ amplitude: 0 }));
    const chunk = planet.buildChunk({ face: 4, lod: 0, x: 0, y: 0 });
    const grid = CHUNK_GRID_SIZE;
    for (let index = 0; index < grid * grid; index += 17) {
      const normal = {
        x: chunk.normals[index * 3] ?? 0,
        y: chunk.normals[index * 3 + 1] ?? 0,
        z: chunk.normals[index * 3 + 2] ?? 0,
      };
      expect(length(normal)).toBeCloseTo(1, 4);
      expect(dot(normal, worldAt(chunk, index))).toBeGreaterThan(0);
    }

    const surfaceEdge = surfaceIndex(0, 4);
    const skirt = grid * grid;
    expect(length(worldAt(chunk, skirt))).toBeLessThan(length(worldAt(chunk, surfaceEdge)) - 1);

    const a = worldAt(chunk, chunk.indices[0] ?? 0);
    const b = worldAt(chunk, chunk.indices[1] ?? 0);
    const c = worldAt(chunk, chunk.indices[2] ?? 0);
    const winding = {
      x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
      y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
      z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
    };
    expect(dot(winding, a)).toBeGreaterThan(0);
  });

  it("matches vertices across a shared edge, including cube-face borders", () => {
    const planet = fastPlanet();
    const left = planet.buildChunk({ face: 0, lod: 1, x: 0, y: 1 });
    const right = planet.buildChunk({ face: 0, lod: 1, x: 1, y: 1 });
    expectEdgeClose(left, edgeIndices(CHUNK_GRID_SIZE - 1, null), right, edgeIndices(0, null));

    const root = planet.buildChunk({ face: 0, lod: 0, x: 0, y: 0 });
    const neighborRequest = adjacentChunk(root.request, 1);
    const neighbor = planet.buildChunk(neighborRequest);
    expectBoundaryClose(root, edgeIndices(CHUNK_GRID_SIZE - 1, null), neighbor);
  });

  it("rejects a request outside the quadtree", () => {
    const planet = fastPlanet();
    expect(() =>
      planet.buildChunk({ face: 6, lod: 0, x: 0, y: 0 } as unknown as ChunkRequest),
    ).toThrow(/face/);
    expect(() => planet.buildChunk({ face: 0, lod: -1, x: 0, y: 0 })).toThrow(/lod/);
    expect(() => planet.buildChunk({ face: 0, lod: 1, x: 2, y: 0 })).toThrow(/chunk x/);
  });
});

describe("cube-face neighbors", () => {
  it("shares the geometric edge with the adjacent chunk on every face", () => {
    for (const face of [0, 1, 2, 3, 4, 5] as const) {
      for (const lod of [0, 2, 5]) {
        const tiles = 2 ** lod;
        for (const direction of [0, 1, 2, 3] as const) {
          const alongValues = lod === 0 ? [0] : [0, Math.floor(tiles / 2), tiles - 1];
          for (const along of alongValues) {
            const request = boundaryRequest(face, lod, direction, along);
            const neighbor = adjacentChunk(request, direction);
            expect(neighbor.lod).toBe(lod);
            expect(neighbor).not.toEqual(request);
            const cube = edgeMidpoint(request, direction);
            const uv = cubeFaceUv(neighbor.face, cube);
            const patch = chunkPatch(neighbor);
            expect(uv.u).toBeGreaterThanOrEqual(patch.u0 - 1e-4);
            expect(uv.u).toBeLessThanOrEqual(patch.u1 + 1e-4);
            expect(uv.v).toBeGreaterThanOrEqual(patch.v0 - 1e-4);
            expect(uv.v).toBeLessThanOrEqual(patch.v1 + 1e-4);
            const onEdge =
              Math.abs(uv.u - patch.u0) < 1e-4 ||
              Math.abs(uv.u - patch.u1) < 1e-4 ||
              Math.abs(uv.v - patch.v0) < 1e-4 ||
              Math.abs(uv.v - patch.v1) < 1e-4;
            expect(onEdge).toBe(true);
            const sourceDir = spherifyCube(cube);
            const neighborDir = spherifyCube(cubeFacePoint(neighbor.face, uv.u, uv.v));
            expect(length(sub(sourceDir, neighborDir))).toBeLessThan(1e-5);
          }
        }
      }
    }
  });
});

function boundaryRequest(
  face: ChunkRequest["face"],
  lod: number,
  direction: 0 | 1 | 2 | 3,
  along: number,
): ChunkRequest {
  const tiles = 2 ** lod;
  if (direction === 0) return { face, lod, x: 0, y: along };
  if (direction === 1) return { face, lod, x: tiles - 1, y: along };
  if (direction === 2) return { face, lod, x: along, y: 0 };
  return { face, lod, x: along, y: tiles - 1 };
}

function edgeMidpoint(request: ChunkRequest, direction: 0 | 1 | 2 | 3) {
  const { u0, u1, v0, v1 } = chunkPatch(request);
  const u = (u0 + u1) / 2;
  const v = (v0 + v1) / 2;
  if (direction === 0) return cubeFacePoint(request.face, u0, v);
  if (direction === 1) return cubeFacePoint(request.face, u1, v);
  if (direction === 2) return cubeFacePoint(request.face, u, v0);
  return cubeFacePoint(request.face, u, v1);
}

function edgeIndices(fixedI: number | null, fixedJ: number | null): number[] {
  const indices: number[] = [];
  for (let along = 0; along < CHUNK_GRID_SIZE; along++) {
    const i = fixedI ?? along;
    const j = fixedJ ?? along;
    indices.push(surfaceIndex(i, j));
  }
  return indices;
}

function expectEdgeClose(
  source: ChunkData,
  sourceEdge: number[],
  target: ChunkData,
  targetEdge: number[],
) {
  expect(sourceEdge.length).toBe(targetEdge.length);
  for (let index = 0; index < sourceEdge.length; index++) {
    const a = worldAt(source, sourceEdge[index] ?? 0);
    const b = worldAt(target, targetEdge[index] ?? 0);
    expect(length(sub(a, b))).toBeLessThan(0.05);
  }
}

function expectBoundaryClose(source: ChunkData, sourceEdge: number[], neighbor: ChunkData) {
  const grid = CHUNK_GRID_SIZE;
  const boundary: number[] = [];
  for (let i = 0; i < grid; i++) {
    boundary.push(surfaceIndex(i, 0), surfaceIndex(i, grid - 1));
  }
  for (let j = 1; j < grid - 1; j++) {
    boundary.push(surfaceIndex(0, j), surfaceIndex(grid - 1, j));
  }
  const points = boundary.map((index) => worldAt(neighbor, index));
  for (const index of sourceEdge) {
    const point = worldAt(source, index);
    let best = Number.POSITIVE_INFINITY;
    for (const other of points) best = Math.min(best, length(sub(point, other)));
    expect(best).toBeLessThan(0.05);
  }
}
