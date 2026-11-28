import type { Vec3 } from "../noise/domainWarp";
import { PLANET_PARAM_REGISTRY, type PlanetParams } from "../params";
import { shoreWidthMeters } from "../shore";
import { terrainField } from "../terrain";
import { clamp, dot, smoothstep } from "../vec3";
import { classifyBiome } from "./classify";
import {
  CLIMATE_BAKE_RESOLUTION,
  bilinearSample,
  bilinearScalar,
  cellAtDirection,
  climateCellCount,
  climateCellDirection,
  climateNeighbors,
  type BilinearSample,
} from "./grid";
import { materialIndexFromPlate, type PlateSample } from "./material";
import { advectMoisture, type AdvectCell } from "./moisture";
import { samplePlate } from "./plates";
import { seaLevelTemperatureC, surfaceTemperatureC } from "./temperature";
import { prevailingWind } from "./wind";

/**
 * Coarse cubemap of the climate fields. Built once per parameter set.
 * The cache is a pure function of those parameters: a repeated call returns
 * the same arrays, and a different set does not depend on what was baked before.
 */
const CACHE_LIMIT = 4;
const cache = new Map<string, ClimateBake>();

export interface ClimateBake {
  readonly resolution: number;
  readonly seaLevelTemperature: Float32Array;
  readonly moisture: Float32Array;
  readonly rainfall: Float32Array;
  readonly wind: Float32Array;
  readonly oceanDistance: Float32Array;
  readonly continentality: Float32Array;
  readonly crust: Float32Array;
  readonly boundary: Uint8Array;
  readonly volcanic: Float32Array;
  readonly slope: Float32Array;
  readonly seaRelativeHeight: Float32Array;
}

export interface ClimatePoint {
  temperature: number;
  moisture: number;
  rainfall: number;
  windX: number;
  windY: number;
  windZ: number;
  oceanDistance: number;
  continentality: number;
  biomeId: number;
  secondaryBiomeId: number;
  biomeWeight: number;
  materialId: number;
}

export function climateBake(params: PlanetParams): ClimateBake {
  const key = paramsKey(params);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const baked = buildClimateBake(params);
  cache.set(key, baked);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return baked;
}

/**
 * Climate at one direction. Temperature uses this vertex's altitude, not the
 * coarse cell's, so a peak between texels is still colder. `slope` is the
 * mesh slope when the caller has one; otherwise the bake's own slope is used.
 */
export function sampleClimate(
  params: PlanetParams,
  direction: Vec3,
  seaRelativeHeight: number,
  slope?: number,
): ClimatePoint {
  const bake = climateBake(params);
  const sample = bilinearSample(direction, bake.resolution);
  const seaLevelTemperature = bilinearScalar(bake.seaLevelTemperature, sample);
  const temperature = surfaceTemperatureC(seaLevelTemperature, seaRelativeHeight);
  const moisture = clamp(bilinearScalar(bake.moisture, sample), 0, 1);
  const rainfall = Math.max(0, bilinearScalar(bake.rainfall, sample));
  const oceanDistance = Math.max(0, bilinearScalar(bake.oceanDistance, sample));
  const continentality = clamp(bilinearScalar(bake.continentality, sample), 0, 1);
  const wind = bilinearWind(bake.wind, sample);
  const nearest = cellAtDirection(direction, bake.resolution);
  const plate: PlateSample = {
    crust: bake.crust[nearest] ?? 0,
    boundary: bake.boundary[nearest] ?? 0,
    volcanic: bake.volcanic[nearest] ?? 0,
  };
  const usedSlope = slope ?? bake.slope[nearest] ?? 0;
  const materialId = materialIndexFromPlate({
    ...plate,
    slope: usedSlope,
    seaRelativeHeight,
  });
  const biome = classifyBiome({
    temperature,
    moisture,
    seaRelativeHeight,
    slope: usedSlope,
    materialId,
    shoreWidth: shoreWidthMeters(params.radius, params.amplitude),
    sharpness: params.biomeSharpness,
  });
  return {
    temperature,
    moisture,
    rainfall,
    windX: wind.x,
    windY: wind.y,
    windZ: wind.z,
    oceanDistance,
    continentality,
    biomeId: biome.biomeId,
    secondaryBiomeId: biome.secondaryBiomeId,
    biomeWeight: biome.weight,
    materialId,
  };
}

function buildClimateBake(params: PlanetParams): ClimateBake {
  const resolution = CLIMATE_BAKE_RESOLUTION;
  const count = climateCellCount(resolution);
  const neighbors = climateNeighbors(resolution);
  const seaLevelTemperature = new Float32Array(count);
  const seaRelativeHeight = new Float32Array(count);
  const crust = new Float32Array(count);
  const boundary = new Uint8Array(count);
  const volcanic = new Float32Array(count);
  const wind = new Float32Array(count * 3);
  const slope = new Float32Array(count);
  const directions: Vec3[] = new Array(count);
  const ocean = new Uint8Array(count);

  for (let index = 0; index < count; index++) {
    const direction = climateCellDirection(index, resolution);
    directions[index] = direction;
    const field = terrainField(params, direction);
    const height = field.height - params.seaLevel;
    seaRelativeHeight[index] = height;
    ocean[index] = height < 0 ? 1 : 0;
    seaLevelTemperature[index] = seaLevelTemperatureC(params, direction);
    const plate = samplePlate(params, direction, field.mask);
    crust[index] = plate.crust;
    boundary[index] = plate.boundary;
    volcanic[index] = plate.volcanic;
    const flow = prevailingWind(direction);
    const windOffset = index * 3;
    wind[windOffset] = flow.x;
    wind[windOffset + 1] = flow.y;
    wind[windOffset + 2] = flow.z;
  }

  for (let index = 0; index < count; index++) {
    slope[index] = cellSlope(index, seaRelativeHeight, directions, neighbors, params.radius);
  }

  const oceanDistance = oceanDistances(ocean, neighbors, params.radius, resolution);
  const continentality = new Float32Array(count);
  const inlandScale = Math.max(params.radius * 0.2, 1);
  for (let index = 0; index < count; index++) {
    continentality[index] =
      ocean[index] === 1 ? 0 : 1 - Math.exp(-(oceanDistance[index] ?? 0) / inlandScale);
  }

  const cells: AdvectCell[] = new Array(count);
  for (let index = 0; index < count; index++) {
    const seaTemperature = seaLevelTemperature[index] ?? 0;
    const evaporation =
      (0.22 + 0.78 * smoothstep(-4, 26, seaTemperature)) * Math.max(params.globalMoisture, 0);
    cells[index] = {
      ocean: ocean[index] === 1,
      height: seaRelativeHeight[index] ?? 0,
      upwind: upwindCell(index, wind, directions, neighbors),
      evaporation,
    };
  }

  const advected = advectMoisture(cells, params.windStrength, resolution * 2);
  const moisture = advected.moisture;
  for (let index = 0; index < count; index++) {
    if (ocean[index] === 1) continue;
    const inland = continentality[index] ?? 0;
    moisture[index] = Math.max(0, (moisture[index] ?? 0) * (1 - 0.68 * inland));
  }

  return {
    resolution,
    seaLevelTemperature,
    moisture,
    rainfall: advected.rainfall,
    wind,
    oceanDistance,
    continentality,
    crust,
    boundary,
    volcanic,
    slope,
    seaRelativeHeight,
  };
}

function cellSlope(
  index: number,
  heights: Float32Array,
  directions: readonly Vec3[],
  neighbors: Int32Array,
  radius: number,
): number {
  const origin = directions[index];
  const height = heights[index] ?? 0;
  if (!origin) return 0;
  let steepest = 0;
  for (let slot = 0; slot < 4; slot++) {
    const neighbor = neighbors[index * 4 + slot] ?? -1;
    const there = directions[neighbor];
    if (!there || neighbor < 0) continue;
    const angle = Math.acos(clamp(dot(origin, there), -1, 1));
    const distance = Math.max(angle * radius, 1);
    const climb = Math.abs((heights[neighbor] ?? height) - height);
    steepest = Math.max(steepest, Math.atan(climb / distance));
  }
  return steepest;
}

function upwindCell(
  index: number,
  wind: Float32Array,
  directions: readonly Vec3[],
  neighbors: Int32Array,
): number {
  const origin = directions[index];
  if (!origin) return -1;
  const windOffset = index * 3;
  const windX = wind[windOffset] ?? 0;
  const windY = wind[windOffset + 1] ?? 0;
  const windZ = wind[windOffset + 2] ?? 0;
  let best = -1;
  let bestScore = 0;
  for (let slot = 0; slot < 4; slot++) {
    const neighbor = neighbors[index * 4 + slot] ?? -1;
    const there = directions[neighbor];
    if (!there || neighbor < 0 || neighbor === index) continue;
    // Positive when the neighbor sits upstream of this cell's wind.
    const score =
      (origin.x - there.x) * windX + (origin.y - there.y) * windY + (origin.z - there.z) * windZ;
    if (score > bestScore) {
      bestScore = score;
      best = neighbor;
    }
  }
  return best;
}

function oceanDistances(
  ocean: Uint8Array,
  neighbors: Int32Array,
  radius: number,
  resolution: number,
): Float32Array {
  const count = ocean.length;
  const distance = new Float32Array(count);
  const queued = new Uint8Array(count);
  const queue: number[] = [];
  for (let index = 0; index < count; index++) {
    if (ocean[index] !== 1) continue;
    distance[index] = 0;
    queued[index] = 1;
    queue.push(index);
  }
  const spacing = (Math.max(radius, 1) * Math.PI) / 2 / resolution;
  let head = 0;
  while (head < queue.length) {
    const index = queue[head] ?? 0;
    head += 1;
    const here = distance[index] ?? 0;
    for (let slot = 0; slot < 4; slot++) {
      const neighbor = neighbors[index * 4 + slot] ?? -1;
      if (neighbor < 0 || queued[neighbor] === 1) continue;
      queued[neighbor] = 1;
      distance[neighbor] = here + spacing;
      queue.push(neighbor);
    }
  }
  const fallback = Math.max(radius, 1) * Math.PI;
  for (let index = 0; index < count; index++) {
    if (queued[index] === 1) continue;
    distance[index] = fallback;
  }
  return distance;
}

function bilinearWind(wind: Float32Array, sample: BilinearSample): Vec3 {
  const read = (index: number, axis: number): number => wind[index * 3 + axis] ?? 0;
  const mix = (axis: number): number => {
    const top =
      read(sample.i00, axis) + (read(sample.i10, axis) - read(sample.i00, axis)) * sample.tx;
    const bottom =
      read(sample.i01, axis) + (read(sample.i11, axis) - read(sample.i01, axis)) * sample.tx;
    return top + (bottom - top) * sample.ty;
  };
  const vector = { x: mix(0), y: mix(1), z: mix(2) };
  const magnitude = Math.hypot(vector.x, vector.y, vector.z);
  if (magnitude < 1e-6) return { x: 0, y: 0, z: 0 };
  return { x: vector.x / magnitude, y: vector.y / magnitude, z: vector.z / magnitude };
}

function paramsKey(params: PlanetParams): string {
  let key = String(params.version);
  for (const meta of PLANET_PARAM_REGISTRY) {
    key += `\0${params[meta.key]}`;
  }
  return key;
}
