import type { Vec3 } from "../noise/domainWarp";
import { cross, length, scale } from "../vec3";
import { latitudeRadians } from "./temperature";

const TRADE_LIMIT_DEG = 30;
const WESTERLY_LIMIT_DEG = 60;

export interface WindVector {
  x: number;
  y: number;
  z: number;
}

/**
 * Three-cell mean wind. Trades and polar easterlies blow toward the equator
 * and the west; mid-latitude westerlies blow toward the pole and the east.
 * The southern cells mirror the northern ones because Coriolis flips.
 * The result is a unit tangent, or zero on the pole where "north" vanishes.
 */
export function prevailingWind(direction: Vec3): WindVector {
  const magnitude = Math.hypot(direction.x, direction.y, direction.z);
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new Error("direction must be a finite non-zero vector");
  }
  const radial = {
    x: direction.x / magnitude,
    y: direction.y / magnitude,
    z: direction.z / magnitude,
  };
  const north = {
    x: -radial.x * radial.y,
    y: 1 - radial.y * radial.y,
    z: -radial.z * radial.y,
  };
  const northLength = length(north);
  if (northLength < 1e-4) return { x: 0, y: 0, z: 0 };
  const northUnit = scale(north, 1 / northLength);
  // east = up × north, so at +X the east axis is +Z (counterclockwise from the north pole).
  const east = cross(radial, northUnit);
  const latitude = Math.abs((latitudeRadians(radial) * 180) / Math.PI);
  const hemisphere = radial.y >= 0 ? 1 : -1;
  const { north: northComponent, east: eastComponent } = cellComponents(latitude, hemisphere);
  return {
    x: northUnit.x * northComponent + east.x * eastComponent,
    y: northUnit.y * northComponent + east.y * eastComponent,
    z: northUnit.z * northComponent + east.z * eastComponent,
  };
}

function cellComponents(
  absLatitudeDeg: number,
  hemisphere: number,
): { north: number; east: number } {
  const raw =
    absLatitudeDeg < TRADE_LIMIT_DEG
      ? { north: -hemisphere * 0.55, east: -0.83 }
      : absLatitudeDeg < WESTERLY_LIMIT_DEG
        ? { north: hemisphere * 0.45, east: 0.89 }
        : { north: -hemisphere * 0.4, east: -0.92 };
  const magnitude = Math.hypot(raw.north, raw.east);
  return { north: raw.north / magnitude, east: raw.east / magnitude };
}
