import { normalizeSeed } from "../prng";

export interface WorleyResult {
  /** Euclidean distance to the nearest feature point. */
  f1: number;
  /** Euclidean distance to the second-nearest feature point. */
  f2: number;
}

function mix32(value: number): number {
  let h = value >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Feature-point coordinate in [0, 1) for one cell axis. */
function hashUnit(seed: number, x: number, y: number, z: number): number {
  let h = normalizeSeed(seed);
  h = mix32(h ^ Math.imul(x | 0, 0x9e3779b1));
  h = mix32(h ^ Math.imul(y | 0, 0x85ebca6b));
  h = mix32(h ^ Math.imul(z | 0, 0xc2b2ae35));
  return h / 4294967296;
}

/** The one feature point inside integer cell (cx, cy, cz). */
export function worleyFeaturePoint(
  seed: number,
  cx: number,
  cy: number,
  cz: number,
): readonly [number, number, number] {
  const base = normalizeSeed(seed);
  return [
    cx + hashUnit(base, cx, cy, cz),
    cy + hashUnit(base + 1, cx, cy, cz),
    cz + hashUnit(base + 2, cx, cy, cz),
  ];
}

function consider(best: WorleyResult, distance: number): void {
  if (distance < best.f1) {
    best.f2 = best.f1;
    best.f1 = distance;
  } else if (distance < best.f2) {
    best.f2 = distance;
  }
}

/** Visit cells whose Chebyshev distance from the query cell is `radius`. */
function scanShell(
  seed: number,
  x: number,
  y: number,
  z: number,
  ix: number,
  iy: number,
  iz: number,
  radius: number,
  best: WorleyResult,
): void {
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== radius) continue;
        const [px, py, pz] = worleyFeaturePoint(seed, ix + dx, iy + dy, iz + dz);
        consider(best, Math.hypot(x - px, y - py, z - pz));
      }
    }
  }
}

/**
 * 3D Worley (cellular) noise with one feature point per unit cell.
 * Callers scale coordinates themselves when they want a different cell size.
 *
 * A fixed 3×3×3 misses the second neighbor when that point sits in the next
 * shell and the inner points are all farther away. Shells grow until the
 * closest point the next shell could contain is at least as far as f2.
 */
export function worley(seed: number, x: number, y: number, z: number): WorleyResult {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const best: WorleyResult = { f1: Number.POSITIVE_INFINITY, f2: Number.POSITIVE_INFINITY };
  // Distance from the query to the nearest face of the next unsearched shell.
  const inset = Math.min(x - ix, ix + 1 - x, y - iy, iy + 1 - y, z - iz, iz + 1 - z);

  let radius = 0;
  scanShell(seed, x, y, z, ix, iy, iz, radius, best);
  while (best.f2 > radius + inset) {
    radius += 1;
    scanShell(seed, x, y, z, ix, iy, iz, radius, best);
  }

  return best;
}
