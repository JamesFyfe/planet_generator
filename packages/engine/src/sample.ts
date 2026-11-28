import { fbm } from "./noise/fractal";
import type { Vec3 } from "./noise/domainWarp";
import type { PlanetParams } from "./params";
import type { GlobalBake } from "./tectonics/bake";
import { getGlobalBake } from "./tectonics/bake";
import { add, clamp, cross, dot, normalize, scale, sub } from "./vec3";

export interface PlanetSample {
  /** Radial displacement from the planet radius, in meters. Tectonics plus detail noise. */
  height: number;
  /** `height - seaLevel`, in meters. Negative is below sea level. */
  seaRelativeHeight: number;
  /** Owning plate. The cells partition the sphere. */
  plateId: number;
  /** `CrustKind.oceanic` or `CrustKind.continental`. */
  crust: number;
  /** `BoundaryKind` of the nearest boundary. */
  boundary: number;
  /** Radians to that boundary. */
  boundaryDistance: number;
  /** Boundary relief in meters, before the crust shelf and detail noise. */
  uplift: number;
  /** Hotspot kernel in [0, 1]. */
  hotspot: number;
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
  readonly bake?: GlobalBake;
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
 * Detail noise at the unit-sphere direction, in meters.
 * The field is a function of direction only, so cube edges and poles
 * are ordinary nearby points rather than a 2D parameterization seam.
 * Amplitude is applied once here; the tectonic shelf comes from the bake.
 */
function detailHeight(params: PlanetParams, unitDir: Vec3): number {
  // Slider and JSON values can land a hair off an integer. fBm requires a whole octave count.
  const octaves = Math.round(params.octaves);
  const noise = fbm(params.seed, unitDir.x, unitDir.y, unitDir.z, {
    octaves,
    frequency: params.noiseScale,
  });
  return noise * params.amplitude;
}

function fieldsFor(params: PlanetParams, bake?: GlobalBake): GlobalBake {
  return bake ?? getGlobalBake(params);
}

function assertRadius(radius: number): void {
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error("radius must be a finite number > 0");
  }
}

export function sampleDirection(params: PlanetParams, dir: Vec3, bake?: GlobalBake): PlanetSample {
  const direction = normalize(dir);
  const tectonic = fieldsFor(params, bake).sample(direction);
  const height = tectonic.height + detailHeight(params, direction);
  return {
    height,
    seaRelativeHeight: height - params.seaLevel,
    plateId: tectonic.plateId,
    crust: tectonic.crust,
    boundary: tectonic.boundary,
    boundaryDistance: tectonic.boundaryDistance,
    uplift: tectonic.uplift,
    hotspot: tectonic.hotspot,
  };
}

function displaced(params: PlanetParams, dir: Vec3, bake?: GlobalBake): Vec3 {
  const direction = normalize(dir);
  const height = sampleDirection(params, direction, bake).height;
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
export function surfaceFrame(params: PlanetParams, dir: Vec3, bake?: GlobalBake): SurfaceFrame {
  assertRadius(params.radius);
  const direction = normalize(dir);
  const fields = fieldsFor(params, bake);
  const sample = sampleDirection(params, direction, fields);
  const position = scale(direction, 1 + sample.height / params.radius);
  const { tangent, bitangent } = tangentFrame(direction);
  const aheadT = displaced(params, add(direction, scale(tangent, NORMAL_EPSILON)), fields);
  const aheadB = displaced(params, add(direction, scale(bitangent, NORMAL_EPSILON)), fields);
  const normal = normalize(cross(sub(aheadT, position), sub(aheadB, position)));
  const slope = Math.acos(clamp(dot(normal, direction), -1, 1));
  return { direction, position, normal, slope, sample };
}
