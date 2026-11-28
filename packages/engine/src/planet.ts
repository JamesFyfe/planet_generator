import { buildChunk as buildChunkData } from "./chunk";
import type { ChunkData, ChunkRequest } from "./chunk";
import type { Vec3 } from "./noise/domainWarp";
import type { PlanetParams } from "./params";
import { sampleDirection } from "./sample";
import type { PlanetSample } from "./sample";
import type { GlobalBake } from "./tectonics/bake";
import { getGlobalBake } from "./tectonics/bake";

export interface Planet {
  readonly params: PlanetParams;
  /** Coarse fields shared by every chunk of this parameter set. */
  readonly bake: GlobalBake;
  sample(dir: Vec3): PlanetSample;
  /** Main-thread chunk mesh. A worker can call the same `buildChunk` function. */
  buildChunk(request: ChunkRequest): ChunkData;
}

/**
 * Frozen snapshot of `params`. Later edits to the caller's object do not
 * change samples or chunks from this planet. The bake is cached by the
 * tectonic inputs, so this only fills a cubemap when those inputs are new.
 */
export function createPlanet(params: PlanetParams): Planet {
  const snapshot: PlanetParams = { ...params };
  Object.freeze(snapshot);
  const bake = getGlobalBake(snapshot);
  return {
    params: snapshot,
    bake,
    sample(dir: Vec3): PlanetSample {
      return sampleDirection(snapshot, dir, bake);
    },
    buildChunk(request: ChunkRequest): ChunkData {
      return buildChunkData(snapshot, request, bake);
    },
  };
}
