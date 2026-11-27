export interface Prng {
  /** Next float in [0, 1). */
  next(): number;
  /** Next integer in [0, max). */
  nextInt(max: number): number;
  /** Next float in [min, max). */
  nextFloat(min: number, max: number): number;
}

/**
 * Coerce any finite number into the uint32 seed space the PRNG and noise
 * functions share. Non-finite values become 0 so a bad input still has one
 * defined stream instead of a NaN permutation.
 */
export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0;
  return seed >>> 0;
}

/**
 * mulberry32 keeps its state in one uint32 and only uses operations that
 * match across JS engines, so a seed produces the same sequence in Node,
 * workers, and the browser.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createPrng(seed: number): Prng {
  const next = mulberry32(normalizeSeed(seed));
  return {
    next,
    nextInt(max: number): number {
      if (!Number.isInteger(max) || max <= 0) {
        throw new Error("nextInt max must be a positive integer");
      }
      return Math.floor(next() * max);
    },
    nextFloat(min: number, max: number): number {
      if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) {
        throw new Error("nextFloat requires finite bounds with max > min");
      }
      return min + next() * (max - min);
    },
  };
}
