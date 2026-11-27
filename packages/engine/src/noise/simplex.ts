import { createPrng, normalizeSeed } from "../prng";

const F3 = 1 / 3;
const G3 = 1 / 6;
/**
 * The unnormalized kernel peaks a little under 1/32. This factor maps it
 * into [-1, 1]; the range tests fail if a later edit pushes samples outside.
 */
const SIMPLEX_SCALE = 32;

const GRAD3: readonly (readonly [number, number, number])[] = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
];

interface Permutation {
  perm: Uint8Array;
  permMod12: Uint8Array;
}

/**
 * The permutation is a pure function of the seed. Caching it keeps repeated
 * samples cheap without making the result depend on call order.
 */
const permutations = new Map<number, Permutation>();

function permutation(seed: number): Permutation {
  const key = normalizeSeed(seed);
  const cached = permutations.get(key);
  if (cached) return cached;

  const rng = createPrng(key);
  const source = new Uint8Array(256);
  for (let i = 0; i < 256; i++) source[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const swap = source[i] ?? 0;
    source[i] = source[j] ?? 0;
    source[j] = swap;
  }

  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    const value = source[i & 255] ?? 0;
    perm[i] = value;
    permMod12[i] = value % 12;
  }

  const built = { perm, permMod12 };
  permutations.set(key, built);
  return built;
}

function gradDot(index: number, x: number, y: number, z: number): number {
  const gradient = GRAD3[index];
  if (!gradient) return 0;
  return gradient[0] * x + gradient[1] * y + gradient[2] * z;
}

function contribute(gradientIndex: number, x: number, y: number, z: number): number {
  const t0 = 0.6 - x * x - y * y - z * z;
  if (t0 < 0) return 0;
  const t = t0 * t0;
  return t * t * gradDot(gradientIndex, x, y, z);
}

function rankedOffsets(
  x0: number,
  y0: number,
  z0: number,
): readonly [number, number, number, number, number, number] {
  if (x0 >= y0) {
    if (y0 >= z0) return [1, 0, 0, 1, 1, 0];
    if (x0 >= z0) return [1, 0, 0, 1, 0, 1];
    return [0, 0, 1, 1, 0, 1];
  }
  if (y0 < z0) return [0, 0, 1, 0, 1, 1];
  if (x0 < z0) return [0, 1, 0, 0, 1, 1];
  return [0, 1, 0, 1, 1, 0];
}

function permAt(table: Uint8Array, index: number): number {
  return table[index] ?? 0;
}

/** 3D simplex noise in [-1, 1]. `seed` selects the permutation. */
export function simplex3(seed: number, x: number, y: number, z: number): number {
  const { perm, permMod12 } = permutation(seed);
  const skew = (x + y + z) * F3;
  const i = Math.floor(x + skew);
  const j = Math.floor(y + skew);
  const k = Math.floor(z + skew);
  const unskew = (i + j + k) * G3;
  const x0 = x - (i - unskew);
  const y0 = y - (j - unskew);
  const z0 = z - (k - unskew);
  const [i1, j1, k1, i2, j2, k2] = rankedOffsets(x0, y0, z0);

  const ii = i & 255;
  const jj = j & 255;
  const kk = k & 255;
  const gi0 = permAt(permMod12, ii + permAt(perm, jj + permAt(perm, kk)));
  const gi1 = permAt(permMod12, ii + i1 + permAt(perm, jj + j1 + permAt(perm, kk + k1)));
  const gi2 = permAt(permMod12, ii + i2 + permAt(perm, jj + j2 + permAt(perm, kk + k2)));
  const gi3 = permAt(permMod12, ii + 1 + permAt(perm, jj + 1 + permAt(perm, kk + 1)));

  return (
    SIMPLEX_SCALE *
    (contribute(gi0, x0, y0, z0) +
      contribute(gi1, x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3) +
      contribute(gi2, x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3) +
      contribute(gi3, x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3))
  );
}
