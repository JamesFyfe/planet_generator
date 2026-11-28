import { chunkKey, chunkLodScore, createPlanet, defaultPlanetParams } from "@planet/engine";
import type { ChunkRequest, LodSelectionInput } from "@planet/engine";
import type { ChunkMeshPayload } from "@planet/renderer";
import { describe, expect, it } from "vitest";
import { ChunkCancelled, createPlanetChunkSource } from "./chunkPool";
import type { ChunkExecutor } from "./chunkPool";

const view: LodSelectionInput = {
  cameraPosition: { x: 80_000, y: 0, z: 0 },
  radius: 50_000,
  fovY: Math.PI / 4,
  screenHeight: 800,
  relief: 3_000,
};

function rank(requests: readonly ChunkRequest[]): ChunkRequest[] {
  return [...requests].sort((a, b) => {
    const left = chunkLodScore(a, view);
    const right = chunkLodScore(b, view);
    if (left.screenError !== right.screenError) return right.screenError - left.screenError;
    if (left.distance !== right.distance) return left.distance - right.distance;
    const keyA = chunkKey(a);
    const keyB = chunkKey(b);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });
}

function tiny(request: ChunkRequest): ChunkMeshPayload {
  return {
    request,
    positions: new Float32Array([request.lod, request.x, request.y]),
    normals: new Float32Array([0, 1, 0]),
    colors: new Float32Array([1, 1, 1]),
    indices: new Uint32Array([0, 1, 2]),
    origin: { x: 0, y: 0, z: 0 },
    boundingRadius: 1,
    lit: true,
    generateMs: 1,
  };
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`missing item ${index}`);
  return item;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function gatedExecutor(): {
  executor: ChunkExecutor;
  started: string[];
  release: () => void;
} {
  const started: string[] = [];
  let open: (() => void) | null = null;
  return {
    started,
    release() {
      const next = open;
      open = null;
      next?.();
    },
    executor: {
      build(_params, _channel, request) {
        started.push(chunkKey(request));
        return new Promise<ChunkMeshPayload>((resolve) => {
          open = () => resolve(tiny(request));
        });
      },
    },
  };
}

describe("chunk pool", () => {
  const requests: ChunkRequest[] = [
    { face: 0, lod: 0, x: 0, y: 0 },
    { face: 0, lod: 2, x: 0, y: 0 },
    { face: 5, lod: 1, x: 1, y: 0 },
  ];

  it("generates the largest error first, then the closest", async () => {
    const gate = gatedExecutor();
    const params = defaultPlanetParams();
    const source = createPlanetChunkSource(
      () => createPlanet(params),
      () => "terrain",
      { concurrency: 1, executor: gate.executor },
    );
    const order = rank(requests).map((request) => chunkKey(request));
    source.retain(requests, view);
    const pending = requests.map((request) => source.buildChunk(request));
    await flush();
    expect(gate.started).toEqual([order[0]]);
    gate.release();
    await flush();
    expect(gate.started).toEqual(order.slice(0, 2));
    gate.release();
    await flush();
    gate.release();
    await Promise.all(pending);
    expect(gate.started).toEqual(order);
    source.dispose();
  });

  it("cancels queued work that left the selection", async () => {
    const gate = gatedExecutor();
    const params = defaultPlanetParams();
    const source = createPlanetChunkSource(
      () => createPlanet(params),
      () => "terrain",
      { concurrency: 1, executor: gate.executor },
    );
    const order = rank(requests);
    source.retain(requests, view);
    const pending = new Map(
      order.map((request) => [chunkKey(request), source.buildChunk(request)]),
    );
    await flush();
    const keep = at(order, 0);
    expect(gate.started).toEqual([chunkKey(keep)]);
    source.retain([keep], view);
    await expect(pending.get(chunkKey(at(order, 1)))).rejects.toBeInstanceOf(ChunkCancelled);
    await expect(pending.get(chunkKey(at(order, 2)))).rejects.toBeInstanceOf(ChunkCancelled);
    expect(gate.started).toEqual([chunkKey(keep)]);
    gate.release();
    await expect(pending.get(chunkKey(keep))).resolves.toMatchObject({ request: keep });
    source.dispose();
  });

  it("returns a cached payload without building again and evicts the least recent", async () => {
    const gate = gatedExecutor();
    const params = defaultPlanetParams();
    const source = createPlanetChunkSource(
      () => createPlanet(params),
      () => "terrain",
      { concurrency: 1, cacheSize: 1, executor: gate.executor },
    );
    const first = at(requests, 0);
    const second = at(requests, 1);
    source.retain([first], view);
    const built = source.buildChunk(first);
    await flush();
    gate.release();
    await built;
    expect(gate.started).toHaveLength(1);
    const cached = source.buildChunk(first);
    expect(cached).not.toHaveProperty("then");
    expect(gate.started).toHaveLength(1);

    source.retain([second], view);
    const other = source.buildChunk(second);
    await flush();
    gate.release();
    await other;
    source.retain([first], view);
    const rebuilt = source.buildChunk(first);
    expect(rebuilt).toHaveProperty("then");
    await flush();
    expect(gate.started).toHaveLength(3);
    gate.release();
    await rebuilt;
    source.dispose();
  });

  it("drops the cache when the planet changes", async () => {
    const gate = gatedExecutor();
    let channel: "terrain" | "height" = "terrain";
    const params = defaultPlanetParams();
    const source = createPlanetChunkSource(
      () => createPlanet(params),
      () => channel,
      { concurrency: 1, executor: gate.executor },
    );
    const request = at(requests, 0);
    source.retain([request], view);
    const built = source.buildChunk(request);
    await flush();
    gate.release();
    await built;
    channel = "height";
    source.retain([request], view);
    const again = source.buildChunk(request);
    expect(again).toHaveProperty("then");
    await flush();
    expect(gate.started).toHaveLength(2);
    gate.release();
    await again;
    source.dispose();
  });
});
