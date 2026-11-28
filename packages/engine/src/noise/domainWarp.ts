import { normalizeSeed } from "../prng";
import { simplex3 } from "./simplex";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface DomainWarpOptions {
  /** Displacement, in the same units as the input coordinates. */
  amplitude?: number;
  /** Frequency of the warp field. Does not scale the returned position. */
  frequency?: number;
}

/** Distinct streams so the three axes are not one gradient copied three times. */
const AXIS_Y = 0x85ebca6b;
const AXIS_Z = 0xc2b2ae35;

export function domainWarp(
  seed: number,
  x: number,
  y: number,
  z: number,
  options?: DomainWarpOptions,
  out?: Vec3,
): Vec3 {
  const amplitude = options?.amplitude ?? 1;
  const frequency = options?.frequency ?? 1;
  if (!Number.isFinite(amplitude) || amplitude < 0) {
    throw new Error("amplitude must be a finite number >= 0");
  }
  if (!Number.isFinite(frequency) || frequency <= 0) {
    throw new Error("frequency must be a finite number > 0");
  }
  if (amplitude === 0) {
    if (out) {
      out.x = x;
      out.y = y;
      out.z = z;
      return out;
    }
    return { x, y, z };
  }

  const base = normalizeSeed(seed);
  const sx = x * frequency;
  const sy = y * frequency;
  const sz = z * frequency;
  const result = out ?? { x: 0, y: 0, z: 0 };
  result.x = x + amplitude * simplex3(base, sx, sy, sz);
  result.y = y + amplitude * simplex3((base + AXIS_Y) >>> 0, sx, sy, sz);
  result.z = z + amplitude * simplex3((base + AXIS_Z) >>> 0, sx, sy, sz);
  return result;
}
