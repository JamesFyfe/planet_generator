import { describe, expect, it } from "vitest";
import { chunkKey, chunkPatch } from "./chunk";
import type { ChunkRequest } from "./chunk";
import { CUBE_FACE_COUNT } from "./cubeSphere";
import { adjacentChunk, MAX_LOD_GAP, selectChunks } from "./lod";
import type { LodSelectionInput } from "./lod";

const RADIUS = 50_000;

function inputAt(distance: number, overrides: Partial<LodSelectionInput> = {}): LodSelectionInput {
  return {
    cameraPosition: { x: distance, y: 0, z: 0 },
    radius: RADIUS,
    fovY: Math.PI / 4,
    screenHeight: 800,
    relief: 3_000,
    ...overrides,
  };
}

function areaOf(chunk: ChunkRequest): number {
  return 1 / 4 ** chunk.lod;
}

function assertPartition(chunks: readonly ChunkRequest[]): void {
  const keys = new Set(chunks.map((chunk) => chunkKey(chunk)));
  expect(keys.size).toBe(chunks.length);
  for (const chunk of chunks) {
    let lod = chunk.lod - 1;
    let x = Math.floor(chunk.x / 2);
    let y = Math.floor(chunk.y / 2);
    while (lod >= 0) {
      expect(keys.has(`${chunk.face}:${lod}:${x}:${y}`)).toBe(false);
      if (lod === 0) break;
      lod -= 1;
      x = Math.floor(x / 2);
      y = Math.floor(y / 2);
    }
  }
  for (let face = 0; face < CUBE_FACE_COUNT; face++) {
    const area = chunks
      .filter((chunk) => chunk.face === face)
      .reduce((sum, chunk) => sum + areaOf(chunk), 0);
    expect(area).toBeCloseTo(1, 8);
  }
}

function coveringLeaf(keys: ReadonlySet<string>, cell: ChunkRequest): ChunkRequest | null {
  let lod = cell.lod;
  let x = cell.x;
  let y = cell.y;
  while (lod >= 0) {
    const candidate: ChunkRequest = { face: cell.face, lod, x, y };
    if (keys.has(chunkKey(candidate))) return candidate;
    if (lod === 0) break;
    lod -= 1;
    x = Math.floor(x / 2);
    y = Math.floor(y / 2);
  }
  return null;
}

function assertLodGap(chunks: readonly ChunkRequest[]): void {
  const keys = new Set(chunks.map((chunk) => chunkKey(chunk)));
  const violations: string[] = [];
  for (const chunk of chunks) {
    for (const direction of [0, 1, 2, 3] as const) {
      const covering = coveringLeaf(keys, adjacentChunk(chunk, direction));
      if (!covering) continue;
      if (chunk.lod - covering.lod <= MAX_LOD_GAP) continue;
      violations.push(`${chunkKey(chunk)} ~ ${chunkKey(covering)}`);
      if (violations.length >= 8) break;
    }
    if (violations.length >= 8) break;
  }
  expect(violations, `${chunks.length} chunks`).toEqual([]);
}

describe("selectChunks", () => {
  it("uses one chunk per face when the projected error is below the threshold", () => {
    const chunks = selectChunks(inputAt(RADIUS * 8, { pixelError: 1_000_000, relief: 0 }));
    expect(chunks).toHaveLength(CUBE_FACE_COUNT);
    expect(chunks.every((chunk) => chunk.lod === 0)).toBe(true);
  });

  it("selects more chunks as the camera approaches", () => {
    const far = selectChunks(inputAt(RADIUS * 6));
    const mid = selectChunks(inputAt(RADIUS * 1.8));
    const near = selectChunks(inputAt(RADIUS + 2_000));
    expect(mid.length).toBeGreaterThan(far.length);
    expect(near.length).toBeGreaterThan(mid.length);
    const maxLod = (chunks: readonly ChunkRequest[]) =>
      chunks.reduce((highest, chunk) => Math.max(highest, chunk.lod), 0);
    expect(maxLod(near)).toBeGreaterThan(maxLod(far));
  });

  it("covers each face once and keeps neighbor LODs within one level", () => {
    const views = [
      { x: RADIUS * 4, y: RADIUS * 0.2, z: RADIUS },
      { x: 0, y: RADIUS + 800, z: 0 },
      { x: -RADIUS * 1.3, y: RADIUS * 0.4, z: RADIUS * 0.8 },
      { x: RADIUS + 150, y: 200, z: -300 },
    ];
    for (const cameraPosition of views) {
      const chunks = selectChunks({
        cameraPosition,
        radius: RADIUS,
        fovY: Math.PI / 3,
        screenHeight: 720,
        relief: 2_000,
      });
      assertPartition(chunks);
      assertLodGap(chunks);
    }
  });

  it("refines the chunk under the camera before the far side", () => {
    const chunks = selectChunks(inputAt(RADIUS + 2_000));
    const maxLod = chunks.reduce((highest, chunk) => Math.max(highest, chunk.lod), 0);
    const underCamera = chunks.filter((chunk) => {
      if (chunk.face !== 0) return false;
      const patch = chunkPatch(chunk);
      return patch.u0 <= 0 && patch.u1 >= 0 && patch.v0 <= 0 && patch.v1 >= 0;
    });
    expect(underCamera.length).toBeGreaterThan(0);
    expect(underCamera.every((chunk) => chunk.lod === maxLod)).toBe(true);
    expect(maxLod).toBeGreaterThanOrEqual(7);
  });

  it("is deterministic", () => {
    const input = inputAt(RADIUS * 2.2, { screenHeight: 600 });
    expect(selectChunks(input)).toEqual(selectChunks(input));
  });

  it("rejects a non-positive radius", () => {
    expect(() => selectChunks(inputAt(RADIUS, { radius: 0 }))).toThrow(/radius/);
  });
});
