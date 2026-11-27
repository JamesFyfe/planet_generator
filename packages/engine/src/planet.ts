import { buildChunk as buildChunkData } from "./chunk";
import type { ChunkData, ChunkRequest } from "./chunk";
import type { Vec3 } from "./noise/domainWarp";
import type { PlanetParams } from "./params";
import { sampleDirection } from "./sample";
import type { PlanetSample } from "./sample";

export interface Planet {
  readonly params: PlanetParams;
  sample(dir: Vec3): PlanetSample;
  /** Main-thread chunk mesh. A worker can call the same `buildChunk` function. */
  buildChunk(request: ChunkRequest): ChunkData;
}

/**
 * Frozen snapshot of `params`. Later edits to the caller's object do not
 * change samples or chunks from this planet.
 */
export function createPlanet(params: PlanetParams): Planet {
  const snapshot: PlanetParams = { ...params };
  Object.freeze(snapshot);
  return {
    params: snapshot,
    sample(dir: Vec3): PlanetSample {
      return sampleDirection(snapshot, dir);
    },
    buildChunk(request: ChunkRequest): ChunkData {
      return buildChunkData(snapshot, request);
    },
  };
}
