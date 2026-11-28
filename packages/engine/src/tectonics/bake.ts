import { bakeFieldSources, cubemapSetFromChannels } from "../bake/cubemap";
import { BAKE_RESOLUTION } from "../bake/cubemap";
import type { ChannelSpec, CubemapSet } from "../bake/cubemap";
import type { Vec3 } from "../noise/domainWarp";
import type { PlanetParams } from "../params";
import { tectonicFieldSource } from "./fields";
import { TECTONIC_CHANNELS } from "./fields";
import { createPlateModel, hotspotsWithin } from "./plates";
import type { Hotspot, Plate } from "./plates";

export { BAKE_RESOLUTION };

const REQUIRED_CHANNELS = TECTONIC_CHANNELS.map((channel) => channel.id);

/**
 * Inputs of the cubemap. Detail noise, sea level, and radius are applied
 * when a chunk is built, so dragging those sliders does not rebake.
 */
export function bakeInputKey(params: PlanetParams): string {
  return [
    params.version,
    params.seed,
    params.plateCount,
    params.continentalFraction,
    params.tectonicActivity,
    params.mountainHeight,
    params.riftDepth,
    params.boundaryWarp,
    params.hotspotCount,
  ].join("|");
}

export interface BakeSample {
  /** Crust shelf plus boundary relief, meters. Detail noise is not included. */
  height: number;
  /** Boundary relief only, meters. Positive is uplift, negative is a rift or trench. */
  uplift: number;
  /** Radians to the nearest plate boundary. */
  boundaryDistance: number;
  /** Hotspot kernel in [0, 1]. */
  hotspot: number;
  plateId: number;
  boundary: number;
  crust: number;
}

export interface GlobalBake {
  readonly resolution: number;
  readonly key: string;
  readonly plates: readonly Plate[];
  readonly hotspots: readonly Hotspot[];
  sample(dir: Vec3): BakeSample;
  /** Any channel id, including ones a later phase appends. */
  sampleChannel(id: string, dir: Vec3): number;
  hotspotsWithin(dir: Vec3, angle: number): readonly Hotspot[];
}

export interface GlobalBakeChannelPayload {
  id: string;
  filter: ChannelSpec["filter"];
  data: Float32Array;
}

export interface GlobalBakePayload {
  key: string;
  resolution: number;
  plates: Plate[];
  hotspots: Hotspot[];
  channels: GlobalBakeChannelPayload[];
}

function roundChannel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

interface StoredBake extends GlobalBake {
  /** Underlying channel buffers. `serializeGlobalBake` transfers these. */
  channels: GlobalBakeChannelPayload[];
}

function bakeFromSet(
  key: string,
  plates: readonly Plate[],
  hotspots: readonly Hotspot[],
  fields: CubemapSet,
): StoredBake {
  for (const id of REQUIRED_CHANNELS) {
    if (!fields.specs.some((spec) => spec.id === id)) {
      throw new Error(`bake is missing channel "${id}"`);
    }
  }
  const channels: GlobalBakeChannelPayload[] = fields.specs.map((spec, index) => {
    const map = fields.maps[index];
    if (!map) throw new Error(`bake is missing the map for "${spec.id}"`);
    return { id: spec.id, filter: spec.filter, data: map.data };
  });
  return {
    resolution: fields.resolution,
    key,
    plates,
    hotspots,
    channels,
    sample(dir: Vec3): BakeSample {
      const height = fields.sample("height", dir);
      const uplift = fields.sample("uplift", dir);
      const boundaryDistance = fields.sample("boundaryDistance", dir);
      const hotspot = fields.sample("hotspot", dir);
      return {
        height,
        uplift,
        boundaryDistance: Math.max(0, boundaryDistance),
        hotspot: clamp01(hotspot),
        plateId: roundChannel(fields.sample("plateId", dir)),
        boundary: roundChannel(fields.sample("boundary", dir)),
        crust: roundChannel(fields.sample("crust", dir)),
      };
    },
    sampleChannel(id: string, dir: Vec3): number {
      return fields.sample(id, dir);
    },
    hotspotsWithin(dir: Vec3, angle: number): readonly Hotspot[] {
      return hotspotsWithin(hotspots, dir, angle);
    },
  };
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clonePlate(plate: Plate): Plate {
  return {
    id: plate.id,
    crust: plate.crust,
    rate: plate.rate,
    site: { x: plate.site.x, y: plate.site.y, z: plate.site.z },
    pole: { x: plate.pole.x, y: plate.pole.y, z: plate.pole.z },
  };
}

function cloneHotspot(hotspot: Hotspot): Hotspot {
  return {
    id: hotspot.id,
    radius: hotspot.radius,
    site: { x: hotspot.site.x, y: hotspot.site.y, z: hotspot.site.z },
  };
}

/** Pure bake. Does not touch the cache, so a worker can transfer its buffers away. */
export function createGlobalBake(params: PlanetParams, resolution = BAKE_RESOLUTION): GlobalBake {
  const model = createPlateModel(params);
  const fields = bakeFieldSources(resolution, [tectonicFieldSource(params, model)]);
  return bakeFromSet(
    bakeInputKey(params),
    model.plates.map(clonePlate),
    model.hotspots.map(cloneHotspot),
    fields,
  );
}

const cache = new Map<string, GlobalBake>();
const CACHE_LIMIT = 4;

function remember(bake: GlobalBake): GlobalBake {
  cache.delete(bake.key);
  cache.set(bake.key, bake);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return bake;
}

export function hasGlobalBake(params: PlanetParams): boolean {
  return cache.has(bakeInputKey(params));
}

export function getGlobalBake(params: PlanetParams): GlobalBake {
  const key = bakeInputKey(params);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  return remember(createGlobalBake(params));
}

export function serializeGlobalBake(bake: GlobalBake): GlobalBakePayload {
  const stored = bake as StoredBake;
  if (!stored.channels) throw new Error("bake has no transferable channels");
  return {
    key: bake.key,
    resolution: bake.resolution,
    plates: bake.plates.map(clonePlate),
    hotspots: bake.hotspots.map(cloneHotspot),
    channels: stored.channels,
  };
}

/**
 * Install a worker's buffers as the cached bake for `params`.
 * The arrays are used in place, so the caller must not transfer them again.
 */
export function adoptGlobalBake(params: PlanetParams, payload: GlobalBakePayload): GlobalBake {
  const key = bakeInputKey(params);
  if (payload.key !== key) throw new Error("bake payload does not match params");
  if (payload.resolution !== BAKE_RESOLUTION) {
    throw new Error(`bake resolution must be ${BAKE_RESOLUTION}`);
  }
  const fields = cubemapSetFromChannels(payload.resolution, payload.channels);
  return remember(
    bakeFromSet(key, payload.plates.map(clonePlate), payload.hotspots.map(cloneHotspot), fields),
  );
}
