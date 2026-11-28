import { describe, expect, it } from "vitest";
import { Group, Mesh, MeshStandardMaterial, PerspectiveCamera } from "three";
import type { ChunkRequest, Vec3 } from "@planet/engine";
import { isBeyondHorizon } from "./culling";
import { createChunkMeshManager, type ChunkMeshPayload, type ChunkMeshSource } from "./chunkMeshes";
import { terrainCameraWorld } from "./terrainMaterial";

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
    const second = { ...frame, cacheKey: "second" };
    manager.sync(second);
    expect(pending).toHaveLength(2);
    pending[0]?.(payload({ x: 0, y: 100, z: 0 }, request(2)));
    await Promise.resolve();
    manager.sync(second);
    expect(group.children).toHaveLength(0);
    pending[1]?.(payload({ x: 0, y: 100, z: 0 }, request(2)));
    await Promise.resolve();
    expect(manager.sync(second).chunkCount).toBe(1);
    expect(group.children).toHaveLength(1);
    manager.dispose();
  });

  it("keeps the parent visible until every child mesh is uploaded", async () => {
    const group = new Group();
    const pending = new Map<string, (payload: ChunkMeshPayload) => void>();
    const source: ChunkMeshSource = {
      buildChunk: (chunk) =>
        new Promise<ChunkMeshPayload>((resolve) => {
          pending.set(`${chunk.face}:${chunk.lod}:${chunk.x}:${chunk.y}`, resolve);
        }),
    };
    const manager = createChunkMeshManager(group, source, { buildsPerFrame: 1 });
    const cameraWorld = { x: 0, y: 0, z: 400 };
    const base = {
      cameraWorld,
      camera: cameraLookingAt(cameraWorld),
      cacheKey: "lod",
      planetRadius: 100,
      relief: 0,
    };
    const parent = request(0);
    const children = [
      request(0, 1, 0, 0),
      request(0, 1, 1, 0),
      request(0, 1, 0, 1),
      request(0, 1, 1, 1),
    ];
    const visibleNames = () =>
      group.children.filter((child) => child.visible).map((child) => child.name);

    manager.sync({ ...base, selection: [parent] });
    pending.get("0:0:0:0")?.(payload({ x: 0, y: 0, z: 100 }, parent));
    await Promise.resolve();
    manager.sync({ ...base, selection: [parent] });
    expect(visibleNames()).toEqual(["chunk:0:0:0:0"]);

    const [c0, c1, c2, c3] = children;
    if (!c0 || !c1 || !c2 || !c3) throw new Error("expected four children");
    manager.sync({ ...base, selection: children });
    pending.get("0:1:0:0")?.(payload({ x: 0, y: 0, z: 100 }, c0));
    pending.get("0:1:1:0")?.(payload({ x: 0, y: 0, z: 100 }, c1));
    await Promise.resolve();
    manager.sync({ ...base, selection: children });
    expect(visibleNames()).toEqual(["chunk:0:0:0:0"]);

    pending.get("0:1:0:1")?.(payload({ x: 0, y: 0, z: 100 }, c2));
    pending.get("0:1:1:1")?.(payload({ x: 0, y: 0, z: 100 }, c3));
    await Promise.resolve();
    for (let step = 0; step < 4; step += 1) manager.sync({ ...base, selection: children });
    expect(visibleNames().sort()).toEqual([
      "chunk:0:1:0:0",
      "chunk:0:1:0:1",
      "chunk:0:1:1:0",
      "chunk:0:1:1:1",
    ]);
    expect(group.children.some((child) => child.name === "chunk:0:0:0:0")).toBe(false);

    manager.sync({ ...base, selection: [parent] });
    expect(visibleNames().sort()).toEqual([
      "chunk:0:1:0:0",
      "chunk:0:1:0:1",
      "chunk:0:1:1:0",
      "chunk:0:1:1:1",
    ]);
    pending.get("0:0:0:0")?.(payload({ x: 0, y: 0, z: 100 }, parent));
    await Promise.resolve();
    manager.sync({ ...base, selection: [parent] });
    expect(visibleNames()).toEqual(["chunk:0:0:0:0"]);
    manager.dispose();
  });
});

describe("terrain shader attributes", () => {
  it("binds slope and sea height and shades that chunk without vertex colors", () => {
    const group = new Group();
    const source: ChunkMeshSource = {
      buildChunk: (chunk) => ({
        ...payload({ x: 0, y: 0, z: 100 }, chunk),
        slope: new Float32Array([0.1, 0.4, 0.8]),
        seaRelativeHeight: new Float32Array([20, 400, -30]),
      }),
    };
    const manager = createChunkMeshManager(group, source);
    const cameraWorld = { x: 0, y: 0, z: 400 };
    manager.sync({
      selection: [request(0)],
      cameraWorld,
      camera: cameraLookingAt(cameraWorld),
      cacheKey: "terrain",
      planetRadius: 50_000,
      relief: 4_000,
    });
    const mesh = group.children[0];
    expect(mesh).toBeInstanceOf(Mesh);
    if (!(mesh instanceof Mesh)) throw new Error("expected a mesh");
    expect(mesh.geometry.getAttribute("slope")?.count).toBe(3);
    expect(mesh.geometry.getAttribute("seaHeight")?.count).toBe(3);
    expect(mesh.material).toBeInstanceOf(MeshStandardMaterial);
    if (!(mesh.material instanceof MeshStandardMaterial)) throw new Error("expected a material");
    expect(mesh.material.vertexColors).toBe(false);
    manager.dispose();
  });

  it("adds the camera back onto the chunk so the triplanar point stays put", () => {
    const group = new Group();
    const origin = { x: 12_000, y: -40, z: 8_000 };
    const source: ChunkMeshSource = {
      buildChunk: (chunk) => ({
        ...payload(origin, chunk),
        slope: new Float32Array([0.1, 0.4, 0.8]),
        seaRelativeHeight: new Float32Array([20, 400, -30]),
      }),
    };
    const manager = createChunkMeshManager(group, source);
    const first = { x: 10_000, y: -200, z: 40_000 };
    const frame = {
      selection: [request(0)],
      cameraWorld: first,
      camera: cameraLookingAt(first),
      cacheKey: "terrain",
      planetRadius: 50_000,
      relief: 4_000,
    };
    manager.sync(frame);
    const mesh = group.children[0];
    if (!(mesh instanceof Mesh) || !(mesh.material instanceof MeshStandardMaterial)) {
      throw new Error("expected a terrain mesh");
    }
    const camera = terrainCameraWorld(mesh.material);
    if (!camera) throw new Error("expected a terrain camera uniform");
    expect(mesh.position.x + camera.x).toBeCloseTo(origin.x, 3);
    expect(mesh.position.y + camera.y).toBeCloseTo(origin.y, 3);
    expect(mesh.position.z + camera.z).toBeCloseTo(origin.z, 3);

    const second = { x: -80_000, y: 500, z: 12_000 };
    manager.sync({
      ...frame,
      cameraWorld: second,
      camera: cameraLookingAt(second),
    });
    expect(camera.x).toBeCloseTo(second.x, 3);
    expect(camera.y).toBeCloseTo(second.y, 3);
    expect(camera.z).toBeCloseTo(second.z, 3);
    expect(mesh.position.x + camera.x).toBeCloseTo(origin.x, 3);
    expect(mesh.position.y + camera.y).toBeCloseTo(origin.y, 3);
    expect(mesh.position.z + camera.z).toBeCloseTo(origin.z, 3);
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
