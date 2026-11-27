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

/**
 * 3D Worley (cellular) noise with one feature point per unit cell.
 * Callers scale coordinates themselves when they want a different cell size.
 */
export function worley(seed: number, x: number, y: number, z: number): WorleyResult {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const base = normalizeSeed(seed);
  let f1 = Number.POSITIVE_INFINITY;
  let f2 = Number.POSITIVE_INFINITY;

  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx;
        const cy = iy + dy;
        const cz = iz + dz;
        const px = cx + hashUnit(base, cx, cy, cz);
        const py = cy + hashUnit(base + 1, cx, cy, cz);
        const pz = cz + hashUnit(base + 2, cx, cy, cz);
        const distance = Math.hypot(x - px, y - py, z - pz);
        if (distance < f1) {
          f2 = f1;
          f1 = distance;
        } else if (distance < f2) {
          f2 = distance;
        }
      }
    }
  }

  return { f1, f2 };
}
