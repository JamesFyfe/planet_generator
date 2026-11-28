import { domainWarp } from "./noise/domainWarp";
import type { Vec3 } from "./noise/domainWarp";
import { fbm, ridgedMultifractal } from "./noise/fractal";
import { normalizeSeed } from "./prng";
import type { PlanetParams } from "./params";
import { clamp, normalize, smoothstep } from "./vec3";

/**
 * Distinct from the octave stride inside fBm so a layer does not replay
 * another layer's first octave.
 */
const LAYER_STRIDE = 0x45d9f3b;

const CONTINENT_LAYER = 1;
const MOUNTAIN_LAYER = 2;
const HILL_LAYER = 3;
const DETAIL_LAYER = 4;
const WARP_LAYER = 5;

/** Width of the smooth continent shelf, in fBm units. */
const COAST_WINDOW = 0.16;

const MAX_LAYER_OCTAVES = 16;

function layerSeed(seed: number, layer: number): number {
  return (normalizeSeed(seed) + Math.imul(layer, LAYER_STRIDE)) >>> 0;
}

function layerOctaves(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_LAYER_OCTAVES, Math.max(1, Math.round(value)));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Warp, then project back onto the sphere. Sampling the unnormalized point
 * would scale every layer's frequency by how far the warp pushed it.
 */
function fieldDirection(params: PlanetParams, unitDir: Vec3): Vec3 {
  if (params.warpStrength <= 0) return unitDir;
  const shifted = domainWarp(layerSeed(params.seed, WARP_LAYER), unitDir.x, unitDir.y, unitDir.z, {
    amplitude: params.warpStrength,
    frequency: params.warpScale,
  });
  return normalize(shifted);
}

export interface TerrainField {
  /** Meters of radial displacement. */
  height: number;
  /**
   * Continent shelf in [0, 1]: 0 on the ocean side of the coast noise, 1 inland.
   * This is the mask, not the sea-level test, so a flooded shelf stays continental.
   */
  mask: number;
}

/**
 * Layered height in meters, before the sea-level offset.
 * Continents are a smooth mask (ocean shelf to inland), mountains are ridged
 * and fade out at the coast, hills and detail are fBm. Strengths are weights:
 * dividing by their sum keeps the result inside [-amplitude, amplitude], which
 * is what skirts and the camera far plane assume.
 */
export function terrainField(params: PlanetParams, unitDir: Vec3): TerrainField {
  const continentWeight = params.continentStrength;
  const mountainWeight = params.mountainStrength;
  const hillWeight = params.hillStrength;
  const detailWeight = params.detailStrength;
  const span = continentWeight + mountainWeight + hillWeight + detailWeight;
  const position = fieldDirection(params, unitDir);
  const needsMask =
    continentWeight !== 0 ||
    hillWeight !== 0 ||
    (mountainWeight !== 0 && params.mountainLandBias !== 0);

  const continent = fbm(
    layerSeed(params.seed, CONTINENT_LAYER),
    position.x,
    position.y,
    position.z,
    {
      octaves: layerOctaves(params.continentOctaves),
      frequency: params.continentScale,
    },
  );
  // Higher coast bias demands a higher continent sample before the shelf
  // rises, so the same noise field has more ocean.
  const realMask = smoothstep(
    params.coastBias - COAST_WINDOW,
    params.coastBias + COAST_WINDOW,
    continent,
  );
  if (params.amplitude === 0 || span === 0) return { height: 0, mask: realMask };

  // A zero weight used to leave the mask at 1 and skip the noise. Keep that
  // height path; climate still reads the real shelf.
  let mask = 1;
  if (needsMask) mask = realMask;

  const shelf = mask * 2 - 1;
  let mountain = 0;
  if (mountainWeight !== 0) {
    const ridge = ridgedMultifractal(
      layerSeed(params.seed, MOUNTAIN_LAYER),
      position.x,
      position.y,
      position.z,
      {
        octaves: layerOctaves(params.mountainOctaves),
        frequency: params.mountainScale,
      },
    );
    const inland = smoothstep(0.42, 0.72, mask);
    const gate = lerp(1 - params.mountainLandBias, 1, inland);
    mountain = ridge * gate;
  }

  let hill = 0;
  if (hillWeight !== 0) {
    const hills = fbm(layerSeed(params.seed, HILL_LAYER), position.x, position.y, position.z, {
      octaves: layerOctaves(params.hillOctaves),
      frequency: params.hillScale,
    });
    hill = hills * lerp(0.3, 1, mask);
  }

  let detail = 0;
  if (detailWeight !== 0) {
    detail = fbm(layerSeed(params.seed, DETAIL_LAYER), position.x, position.y, position.z, {
      octaves: layerOctaves(params.detailOctaves),
      frequency: params.detailScale,
    });
  }

  const shaped =
    shelf * continentWeight + mountain * mountainWeight + hill * hillWeight + detail * detailWeight;
  return { height: clamp(shaped / span, -1, 1) * params.amplitude, mask: realMask };
}

/** Radial displacement in meters. Amplitude is applied once, inside {@link terrainField}. */
export function terrainHeight(params: PlanetParams, unitDir: Vec3): number {
  return terrainField(params, unitDir).height;
}

/**
 * Characteristic noise frequency for skirt depth. Detail is down-weighted:
 * its meter contribution is small, and using its raw scale always hit the
 * skirt cap and pulled a thick apron down every coarse edge.
 */
export function terrainSkirtFrequency(params: PlanetParams): number {
  const terms: readonly [number, number][] = [
    [params.continentScale, params.continentStrength],
    [params.mountainScale, params.mountainStrength],
    [params.hillScale, params.hillStrength],
    [params.detailScale, params.detailStrength * 0.25],
  ];
  let weighted = 0;
  let weight = 0;
  for (const [frequency, strength] of terms) {
    if (strength <= 0) continue;
    weighted += frequency * strength;
    weight += strength;
  }
  if (weight <= 0) return 1;
  return Math.max(1, weighted / weight);
}
