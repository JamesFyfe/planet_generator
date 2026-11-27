import { normalizeSeed } from "../prng";
import { simplex3 } from "./simplex";

/** Stride between octave seeds so successive octaves do not share a permutation. */
const OCTAVE_STRIDE = 0x9e3779b1;

/**
 * Cap octaves so a bad parameter cannot request hundreds of samples.
 * Terrain will call these helpers per vertex; the cap is a safety bound.
 */
const MAX_OCTAVES = 16;

export interface FractalOptions {
  octaves?: number;
  lacunarity?: number;
  gain?: number;
  frequency?: number;
}

interface ResolvedFractal {
  octaves: number;
  lacunarity: number;
  gain: number;
  frequency: number;
}

function resolveFractal(options: FractalOptions | undefined): ResolvedFractal {
  const octaves = options?.octaves ?? 4;
  const lacunarity = options?.lacunarity ?? 2;
  const gain = options?.gain ?? 0.5;
  const frequency = options?.frequency ?? 1;
  if (!Number.isInteger(octaves) || octaves < 1 || octaves > MAX_OCTAVES) {
    throw new Error(`octaves must be an integer from 1 to ${MAX_OCTAVES}`);
  }
  if (!Number.isFinite(lacunarity) || lacunarity <= 0) {
    throw new Error("lacunarity must be a finite number > 0");
  }
  if (!Number.isFinite(gain) || gain < 0) {
    throw new Error("gain must be a finite number >= 0");
  }
  if (!Number.isFinite(frequency) || frequency <= 0) {
    throw new Error("frequency must be a finite number > 0");
  }
  return { octaves, lacunarity, gain, frequency };
}

function octaveSeed(seed: number, octave: number): number {
  return (normalizeSeed(seed) + octave * OCTAVE_STRIDE) >>> 0;
}

/** Fractional Brownian motion in [-1, 1], normalized by the amplitude sum. */
export function fbm(
  seed: number,
  x: number,
  y: number,
  z: number,
  options?: FractalOptions,
): number {
  const { octaves, lacunarity, gain, frequency } = resolveFractal(options);
  let amplitude = 1;
  let freq = frequency;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    sum += amplitude * simplex3(octaveSeed(seed, octave), x * freq, y * freq, z * freq);
    norm += amplitude;
    amplitude *= gain;
    freq *= lacunarity;
  }
  return norm === 0 ? 0 : sum / norm;
}

/**
 * Billow noise: absolute simplex, remapped to [-1, 1], then stacked like fBm.
 * The absolute value is what makes the puffy, cloud-like lobes.
 */
export function billow(
  seed: number,
  x: number,
  y: number,
  z: number,
  options?: FractalOptions,
): number {
  const { octaves, lacunarity, gain, frequency } = resolveFractal(options);
  let amplitude = 1;
  let freq = frequency;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    const noise = simplex3(octaveSeed(seed, octave), x * freq, y * freq, z * freq);
    sum += amplitude * (Math.abs(noise) * 2 - 1);
    norm += amplitude;
    amplitude *= gain;
    freq *= lacunarity;
  }
  return norm === 0 ? 0 : sum / norm;
}

/**
 * Ridged multifractal in [0, 1].
 * Weight carries energy into the next octave only where the ridge is already
 * strong, which keeps the result from collapsing into ordinary fBm.
 */
export function ridgedMultifractal(
  seed: number,
  x: number,
  y: number,
  z: number,
  options?: FractalOptions,
): number {
  const { octaves, lacunarity, gain, frequency } = resolveFractal(options);
  let amplitude = 1;
  let freq = frequency;
  let sum = 0;
  let norm = 0;
  let weight = 1;
  for (let octave = 0; octave < octaves; octave++) {
    const noise = simplex3(octaveSeed(seed, octave), x * freq, y * freq, z * freq);
    let signal = 1 - Math.abs(noise);
    signal *= signal;
    signal *= weight;
    weight = Math.min(1, Math.max(0, signal * 2));
    sum += signal * amplitude;
    norm += amplitude;
    amplitude *= gain;
    freq *= lacunarity;
  }
  return norm === 0 ? 0 : sum / norm;
}
