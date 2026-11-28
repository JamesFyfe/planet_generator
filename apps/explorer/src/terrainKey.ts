import type { PlanetParams } from "@planet/engine";

/**
 * Chunk meshes depend only on the height field and the debug channel.
 * Atmosphere, clouds, tilt, and rotation are drawn by the renderer and
 * must not throw the chunk set away.
 */
export function terrainCacheKey(channel: string, params: PlanetParams): string {
  return [
    channel,
    params.seed,
    params.radius,
    params.noiseScale,
    params.octaves,
    params.amplitude,
    params.seaLevel,
  ].join(":");
}
