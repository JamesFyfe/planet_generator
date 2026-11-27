import type { PlanetParams } from "./params";
import type { PlanetSample } from "./sample";
import { clamp } from "./vec3";

export interface DebugChannelMeta {
  id: string;
  label: string;
  /**
   * Terrain is lit so the relief reads. Data channels are unlit so shading
   * does not hide the ramp.
   */
  lit: boolean;
}

/**
 * Named color outputs. `terrain` is the shaded height coloring; `height` and
 * `slope` are the Phase 1 data channels. The explorer builds its dropdown from this list.
 */
export const DEBUG_CHANNEL_REGISTRY = [
  { id: "terrain", label: "Terrain", lit: true },
  { id: "height", label: "Height", lit: false },
  { id: "slope", label: "Slope", lit: false },
] as const satisfies readonly DebugChannelMeta[];

export type DebugChannelId = (typeof DEBUG_CHANNEL_REGISTRY)[number]["id"];

const META_BY_ID = new Map<DebugChannelId, DebugChannelMeta>(
  DEBUG_CHANNEL_REGISTRY.map((channel) => [channel.id, channel]),
);

export function isDebugChannelId(id: string): id is DebugChannelId {
  return META_BY_ID.has(id as DebugChannelId);
}

export function debugChannelMeta(id: DebugChannelId): DebugChannelMeta {
  const meta = META_BY_ID.get(id);
  if (!meta) {
    throw new Error(`Unknown debug channel "${id}"`);
  }
  return meta;
}

type Rgb = readonly [number, number, number];

const OCEAN_DEEP: Rgb = [0.03, 0.12, 0.28];
const OCEAN_SHALLOW: Rgb = [0.16, 0.48, 0.62];
const SHORE: Rgb = [0.84, 0.76, 0.52];
const LAND: Rgb = [0.22, 0.46, 0.22];
const HIGHLAND: Rgb = [0.4, 0.34, 0.24];
const SNOW: Rgb = [0.93, 0.94, 0.95];

const HEIGHT_LOW: Rgb = [0.04, 0.08, 0.38];
const HEIGHT_MID: Rgb = [0.1, 0.72, 0.48];
const HEIGHT_HIGH: Rgb = [0.96, 0.72, 0.18];

const SLOPE_FLAT: Rgb = [0.08, 0.05, 0.16];
const SLOPE_STEEP: Rgb = [0.98, 0.82, 0.2];

/**
 * Shore width is the smaller of a radius fraction and a slice of the relief.
 * A fixed meter beach disappears from orbit; a large fraction of the amplitude
 * turns most low land into beach.
 */
const SHORE_RADIUS_FRACTION = 0.005;
const SHORE_AMPLITUDE_FRACTION = 0.08;

/** Slopes of a few degrees are typical at the default amplitude. This maps them across the ramp. */
const SLOPE_RAMP_RADIANS = 0.2;

function lerp(a: Rgb, b: Rgb, t: number): Rgb {
  const u = clamp(t, 0, 1);
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

function terrainColor(params: PlanetParams, sample: PlanetSample): Rgb {
  const shoreWidth = Math.max(
    Math.min(params.radius * SHORE_RADIUS_FRACTION, params.amplitude * SHORE_AMPLITUDE_FRACTION),
    1,
  );
  if (sample.seaRelativeHeight < 0) {
    const depth = clamp(-sample.seaRelativeHeight / Math.max(params.amplitude, 1), 0, 1);
    return lerp(OCEAN_SHALLOW, OCEAN_DEEP, depth);
  }
  if (sample.seaRelativeHeight < shoreWidth) {
    return SHORE;
  }
  const landSpan = Math.max(params.amplitude - shoreWidth, 1);
  const t = clamp((sample.seaRelativeHeight - shoreWidth) / landSpan, 0, 1);
  if (t < 0.45) return lerp(LAND, HIGHLAND, t / 0.45);
  return lerp(HIGHLAND, SNOW, (t - 0.45) / 0.55);
}

function heightColor(params: PlanetParams, sample: PlanetSample): Rgb {
  const span = Math.max(params.amplitude, 1);
  // Layered noise rarely reaches the full amplitude, so stretch the mid-range
  // or the debug view collapses to one tint.
  const centered = clamp((sample.seaRelativeHeight / span) * 1.8, -1, 1);
  const t = (centered + 1) / 2;
  if (t < 0.5) return lerp(HEIGHT_LOW, HEIGHT_MID, t / 0.5);
  return lerp(HEIGHT_MID, HEIGHT_HIGH, (t - 0.5) / 0.5);
}

function slopeColor(slope: number): Rgb {
  return lerp(SLOPE_FLAT, SLOPE_STEEP, slope / SLOPE_RAMP_RADIANS);
}

export function colorForChannel(
  channel: DebugChannelId,
  params: PlanetParams,
  sample: PlanetSample,
  slope: number,
): Rgb {
  switch (channel) {
    case "terrain":
      return terrainColor(params, sample);
    case "height":
      return heightColor(params, sample);
    case "slope":
      return slopeColor(slope);
    default: {
      const unknown: never = channel;
      throw new Error(`Unknown debug channel "${String(unknown)}"`);
    }
  }
}
