import { sampleClimate } from "./climate/bake";
import type { Vec3 } from "./noise/domainWarp";
import type { PlanetParams } from "./params";
import { terrainHeight } from "./terrain";
import { add, clamp, cross, dot, normalize, scale, sub } from "./vec3";

export interface PlanetSample {
  /** Radial displacement from the planet radius, in meters. Already includes amplitude. */
  height: number;
  /** `height - seaLevel`, in meters. Negative is below sea level. */
  seaRelativeHeight: number;
  /** Mean annual surface temperature, °C. */
  temperature: number;
  /** 0 dry, 1 saturated. */
  moisture: number;
  /** Moisture dropped on the coarse cell, in the same 0–1 units. */
  rainfall: number;
  windX: number;
  windY: number;
  windZ: number;
  /** Meters to the nearest ocean cell on the climate bake. */
  oceanDistance: number;
  /** 0 on the coast, approaching 1 deep inland. */
  continentality: number;
  biomeId: number;
  secondaryBiomeId: number;
  /** Weight of {@link biomeId}. The remainder is the secondary biome. */
  biomeWeight: number;
  materialId: number;
}

export interface SurfaceFrame {
  direction: Vec3;
  /** Planet-centered position divided by radius, so the undisturbed body is the unit sphere. */
  position: Vec3;
  normal: Vec3;
  /** Angle between the normal and the radial direction, in radians. */
  slope: number;
  sample: PlanetSample;
}

/**
 * Sampler surface used by the single-resolution mesh.
 * `createPlanet` lives in `planet.ts` so chunk generation can call
 * `sampleDirection` without a cycle through the chunk builder.
 */
export interface Planet {
  readonly params: PlanetParams;
  sample(dir: Vec3): PlanetSample;
}

/**
 * Finite-difference step in radians on the unit sphere.
 * Small enough to follow the displacement, large enough that float64
 * subtraction still sees the slope.
 */
const NORMAL_EPSILON = 1e-4;

const Y_AXIS: Vec3 = { x: 0, y: 1, z: 0 };
const X_AXIS: Vec3 = { x: 1, y: 0, z: 0 };

/**
 * Layered terrain at the unit-sphere direction, in meters.
 * The field is a function of direction only, so cube edges and poles
 * are ordinary nearby points rather than a 2D parameterization seam.
 * Relief is applied once inside {@link terrainHeight}; mesh displacement adds `height` to the radius.
 */
function noiseHeight(params: PlanetParams, unitDir: Vec3): number {
  return terrainHeight(params, unitDir);
}

function assertRadius(radius: number): void {
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error("radius must be a finite number > 0");
  }
}

export function sampleDirection(params: PlanetParams, dir: Vec3): PlanetSample {
  const direction = normalize(dir);
  const height = noiseHeight(params, direction);
  const seaRelativeHeight = height - params.seaLevel;
  return {
    height,
    seaRelativeHeight,
    ...sampleClimate(params, direction, seaRelativeHeight),
  };
}

function displaced(params: PlanetParams, dir: Vec3): Vec3 {
  const direction = normalize(dir);
  const height = noiseHeight(params, direction);
  return scale(direction, 1 + height / params.radius);
}

function tangentFrame(direction: Vec3): { tangent: Vec3; bitangent: Vec3 } {
  // A radial vector parallel to the reference axis would make the cross product vanish.
  const reference = Math.abs(direction.y) < 0.9 ? Y_AXIS : X_AXIS;
  const tangent = normalize(cross(reference, direction));
  const bitangent = normalize(cross(direction, tangent));
  return { tangent, bitangent };
}

/**
 * Normal from central differences on the displaced sphere, not from the mesh.
 * Edge vertices on adjacent cube faces share a direction, so they share this normal.
 */
export function surfaceFrame(params: PlanetParams, dir: Vec3): SurfaceFrame {
  assertRadius(params.radius);
  const direction = normalize(dir);
  const height = noiseHeight(params, direction);
  const seaRelativeHeight = height - params.seaLevel;
  const position = scale(direction, 1 + height / params.radius);
  const { tangent, bitangent } = tangentFrame(direction);
  const aheadT = displaced(params, add(direction, scale(tangent, NORMAL_EPSILON)));
  const aheadB = displaced(params, add(direction, scale(bitangent, NORMAL_EPSILON)));
  const normal = normalize(cross(sub(aheadT, position), sub(aheadB, position)));
  const slope = Math.acos(clamp(dot(normal, direction), -1, 1));
  const sample: PlanetSample = {
    height,
    seaRelativeHeight,
    ...sampleClimate(params, direction, seaRelativeHeight, slope),
  };
  return { direction, position, normal, slope, sample };
}
