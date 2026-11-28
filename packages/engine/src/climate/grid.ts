import { cubeFaceIndex, cubeFacePoint, cubeFaceUv, spherifyCube } from "../cubeSphere";
import type { Vec3 } from "../noise/domainWarp";
import { clamp } from "../vec3";

/**
 * Cells along one edge of a cube face. 32 is coarse next to a chunk, and
 * wide enough that a mountain belt (wavelength of tens of kilometers on the
 * default planet) still occupies several cells.
 */
export const CLIMATE_BAKE_RESOLUTION = 32;

const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function climateCellCount(resolution = CLIMATE_BAKE_RESOLUTION): number {
  return 6 * resolution * resolution;
}

export function climateCellIndex(
  face: number,
  x: number,
  y: number,
  resolution = CLIMATE_BAKE_RESOLUTION,
): number {
  return (face * resolution + y) * resolution + x;
}

export function climateCellDirection(index: number, resolution = CLIMATE_BAKE_RESOLUTION): Vec3 {
  const perFace = resolution * resolution;
  const face = Math.floor(index / perFace);
  const local = index - face * perFace;
  const y = Math.floor(local / resolution);
  const x = local - y * resolution;
  const u = -1 + ((x + 0.5) * 2) / resolution;
  const v = -1 + ((y + 0.5) * 2) / resolution;
  return spherifyCube(cubeFacePoint(face, u, v));
}

/**
 * Four UV neighbors, crossing onto the adjacent cube face past an edge.
 * Built once per resolution. The table is a pure function of that resolution.
 */
export function climateNeighbors(resolution = CLIMATE_BAKE_RESOLUTION): Int32Array {
  const cached = NEIGHBORS.get(resolution);
  if (cached) return cached;
  const count = climateCellCount(resolution);
  const neighbors = new Int32Array(count * 4);
  for (let index = 0; index < count; index++) {
    const perFace = resolution * resolution;
    const face = Math.floor(index / perFace);
    const local = index - face * perFace;
    const y = Math.floor(local / resolution);
    const x = local - y * resolution;
    for (let step = 0; step < STEPS.length; step++) {
      const delta = STEPS[step];
      if (!delta) continue;
      neighbors[index * 4 + step] = neighborCell(face, x, y, delta[0], delta[1], resolution);
    }
  }
  NEIGHBORS.set(resolution, neighbors);
  return neighbors;
}

const NEIGHBORS = new Map<number, Int32Array>();

function neighborCell(
  face: number,
  x: number,
  y: number,
  du: number,
  dv: number,
  resolution: number,
): number {
  const step = 2 / resolution;
  const u = -1 + ((x + 0.5) * 2) / resolution + du * step;
  const v = -1 + ((y + 0.5) * 2) / resolution + dv * step;
  if (u >= -1 && u <= 1 && v >= -1 && v <= 1) {
    const nx = clamp(Math.floor(((u + 1) / 2) * resolution), 0, resolution - 1);
    const ny = clamp(Math.floor(((v + 1) / 2) * resolution), 0, resolution - 1);
    return climateCellIndex(face, nx, ny, resolution);
  }
  const extrapolated = cubeFacePoint(face, u, v);
  return cellAtDirection(extrapolated, resolution);
}

export function cellAtDirection(direction: Vec3, resolution = CLIMATE_BAKE_RESOLUTION): number {
  const face = cubeFaceIndex(direction);
  const dominant = Math.max(Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z));
  if (!Number.isFinite(dominant) || dominant === 0) {
    throw new Error("direction must be a finite non-zero vector");
  }
  const cube = {
    x: direction.x / dominant,
    y: direction.y / dominant,
    z: direction.z / dominant,
  };
  const { u, v } = cubeFaceUv(face, cube);
  const x = clamp(Math.floor(((u + 1) / 2) * resolution), 0, resolution - 1);
  const y = clamp(Math.floor(((v + 1) / 2) * resolution), 0, resolution - 1);
  return climateCellIndex(face, x, y, resolution);
}

export interface BilinearSample {
  i00: number;
  i10: number;
  i01: number;
  i11: number;
  tx: number;
  ty: number;
}

/** Face-local bilinear weights. A sample on the shared edge clamps to that face. */
export function bilinearSample(
  direction: Vec3,
  resolution = CLIMATE_BAKE_RESOLUTION,
): BilinearSample {
  const face = cubeFaceIndex(direction);
  const dominant = Math.max(Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z));
  if (!Number.isFinite(dominant) || dominant === 0) {
    throw new Error("direction must be a finite non-zero vector");
  }
  const { u, v } = cubeFaceUv(face, {
    x: direction.x / dominant,
    y: direction.y / dominant,
    z: direction.z / dominant,
  });
  const fx = ((u + 1) / 2) * resolution - 0.5;
  const fy = ((v + 1) / 2) * resolution - 0.5;
  const x0 = clamp(Math.floor(fx), 0, resolution - 1);
  const y0 = clamp(Math.floor(fy), 0, resolution - 1);
  const x1 = clamp(x0 + 1, 0, resolution - 1);
  const y1 = clamp(y0 + 1, 0, resolution - 1);
  return {
    i00: climateCellIndex(face, x0, y0, resolution),
    i10: climateCellIndex(face, x1, y0, resolution),
    i01: climateCellIndex(face, x0, y1, resolution),
    i11: climateCellIndex(face, x1, y1, resolution),
    tx: clamp(fx - x0, 0, 1),
    ty: clamp(fy - y0, 0, 1),
  };
}

export function bilinearScalar(field: Float32Array, sample: BilinearSample): number {
  const a = field[sample.i00] ?? 0;
  const b = field[sample.i10] ?? 0;
  const c = field[sample.i01] ?? 0;
  const d = field[sample.i11] ?? 0;
  const top = a + (b - a) * sample.tx;
  const bottom = c + (d - c) * sample.tx;
  return top + (bottom - top) * sample.ty;
}
