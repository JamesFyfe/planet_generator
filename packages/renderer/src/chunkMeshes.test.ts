import { describe, expect, it } from "vitest";
import { Group, PerspectiveCamera } from "three";
import type { ChunkRequest, Vec3 } from "@planet/engine";
import { isBeyondHorizon } from "./culling";
import { createChunkMeshManager, type ChunkMeshPayload, type ChunkMeshSource } from "./chunkMeshes";

const request = (face: ChunkRequest["face"], lod = 0, x = 0, y = 0): ChunkRequest => ({
  face,
  lod,
  x,
  y,
});

function payload(origin: Vec3, chunk: ChunkRequest, generateMs = 2): ChunkMeshPayload {
  return {
    request: chunk,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    colors: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    origin,
    boundingRadius: 8,
    lit: true,
    generateMs,
  };
}

function cameraLookingAt(world: Vec3): PerspectiveCamera {
  const camera = new PerspectiveCamera(45, 1, 0.5, 100_000);
  camera.position.set(0, 0, 0);
  camera.up.set(0, 1, 0);
  camera.lookAt(-world.x, -world.y, -world.z);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

describe("chunk mesh manager", () => {
  it("adds and removes meshes as the selection changes", () => {
    const group = new Group();
    const built: ChunkRequest[] = [];
    const source: ChunkMeshSource = {
      buildChunk(chunk) {
        built.push(chunk);
        return payload({ x: 0, y: 0, z: 100 }, chunk);
      },
    };
    const manager = createChunkMeshManager(group, source);
    const cameraWorld = { x: 0, y: 0, z: 400 };
    const frame = {
      cameraWorld,
      camera: cameraLookingAt(cameraWorld),
      cacheKey: "a",
      planetRadius: 100,
      relief: 0,
    };
    const first = manager.sync({ ...frame, selection: [request(0), request(4)] });
    expect(built).toHaveLength(2);
    expect(group.children).toHaveLength(2);
    expect(first.chunkCount).toBe(2);
    expect(first.maxLod).toBe(0);
    expect(first.lastGenerateMs).toBe(2);

    manager.sync({ ...frame, selection: [request(0)] });
    expect(built).toHaveLength(2);
    expect(group.children).toHaveLength(1);
    expect(group.children[0]?.name).toBe("chunk:0:0:0:0");
    manager.dispose();
  });

  it("places chunk-local meshes at origin minus the camera", () => {
    const group = new Group();
    const origin = { x: 50_000, y: 20, z: -15 };
    const cameraWorld = { x: 50_040, y: 0, z: 5 };
    const source: ChunkMeshSource = {
      buildChunk: (chunk) => payload(origin, chunk),
    };
    const manager = createChunkMeshManager(group, source);
    manager.sync({
      selection: [request(1)],
      cameraWorld,
      camera: cameraLookingAt(cameraWorld),
      cacheKey: "meters",
      planetRadius: 50_000,
      relief: 1_000,
    });
    const mesh = group.children[0];
    expect(mesh?.position.x).toBeCloseTo(origin.x - cameraWorld.x, 4);
    expect(mesh?.position.y).toBeCloseTo(origin.y - cameraWorld.y, 4);
    expect(mesh?.position.z).toBeCloseTo(origin.z - cameraWorld.z, 4);
    manager.dispose();
  });

  it("hides chunks outside the frustum and past the horizon", () => {
    const group = new Group();
    const cameraWorld = { x: 0, y: 0, z: 400 };
    const near = request(4);
    const far = request(5);
    const behind = request(0, 1, 0, 0);
    const source: ChunkMeshSource = {
      buildChunk(chunk) {
        if (chunk.face === 4) return payload({ x: 0, y: 0, z: 100 }, chunk);
        if (chunk.face === 5) return payload({ x: 0, y: 0, z: -100 }, chunk);
        return payload({ x: 0, y: 0, z: 800 }, chunk);
      },
    };
    const manager = createChunkMeshManager(group, source);
    const stats = manager.sync({
      selection: [near, far, behind],
      cameraWorld,
      camera: cameraLookingAt(cameraWorld),
      cacheKey: "cull",
      planetRadius: 100,
      relief: 0,
    });
    const byName = new Map(group.children.map((child) => [child.name, child]));
    expect(byName.get("chunk:4:0:0:0")?.visible).toBe(true);
    expect(byName.get("chunk:5:0:0:0")?.visible).toBe(false);
    expect(byName.get("chunk:0:1:0:0")?.visible).toBe(false);
    expect(stats.visibleCount).toBe(1);
    expect(stats.chunkCount).toBe(3);
    manager.dispose();
  });

  it("drops a build that finishes after the planet changes", async () => {
    const group = new Group();
    const pending: ((payload: ChunkMeshPayload) => void)[] = [];
    const source: ChunkMeshSource = {
      buildChunk: () =>
        new Promise<ChunkMeshPayload>((resolve) => {
          pending.push(resolve);
        }),
    };
    const manager = createChunkMeshManager(group, source);
    const cameraWorld = { x: 0, y: 0, z: 400 };
    const frame = {
      selection: [request(2)],
      cameraWorld,
      camera: cameraLookingAt(cameraWorld),
      cacheKey: "first",
      planetRadius: 100,
      relief: 0,
    };
    expect(manager.sync(frame).chunkCount).toBe(0);
    expect(pending).toHaveLength(1);
    manager.sync({ ...frame, cacheKey: "second" });
    expect(pending).toHaveLength(2);
    pending[0]?.(payload({ x: 0, y: 100, z: 0 }, request(2)));
    await Promise.resolve();
    expect(group.children).toHaveLength(0);
    pending[1]?.(payload({ x: 0, y: 100, z: 0 }, request(2)));
    await Promise.resolve();
    expect(group.children).toHaveLength(1);
    manager.dispose();
  });
});

describe("horizon culling", () => {
  it("keeps the near cap and drops the far side", () => {
    const camera = { x: 0, y: 0, z: 400 };
    expect(isBeyondHorizon(camera, { x: 0, y: 0, z: 100 }, 8, 100)).toBe(false);
    expect(isBeyondHorizon(camera, { x: 0, y: 0, z: -100 }, 8, 100)).toBe(true);
  });
});
