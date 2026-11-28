import { BIOMES } from "./data/biomes";
import { MATERIALS } from "./data/materials";
import type { PlanetParams } from "./params";
import type { PlanetSample } from "./sample";
import { shoreWidthMeters } from "./shore";
import { clamp, smoothstep } from "./vec3";

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
  { id: "lod", label: "LOD", lit: false },
  { id: "temperature", label: "Temperature", lit: false },
  { id: "moisture", label: "Moisture", lit: false },
  { id: "wind", label: "Wind", lit: false },
  { id: "rainfall", label: "Rainfall", lit: false },
  { id: "biome", label: "Biome", lit: false },
  { id: "material", label: "Material", lit: false },
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

/** Height coloring still works when a caller has not filled the climate fields. */
export type ColorSample = Pick<PlanetSample, "height" | "seaRelativeHeight"> &
  Partial<PlanetSample>;

const OCEAN_DEEP: Rgb = [0.03, 0.12, 0.28];
const OCEAN_SHALLOW: Rgb = [0.16, 0.48, 0.62];
const SHORE: Rgb = [0.84, 0.76, 0.52];
const LAND: Rgb = [0.22, 0.46, 0.22];
const HIGHLAND: Rgb = [0.4, 0.34, 0.24];
const SNOW: Rgb = [0.93, 0.94, 0.95];
const ROCK: Rgb = [0.45, 0.4, 0.36];

const HEIGHT_LOW: Rgb = [0.04, 0.08, 0.38];
const HEIGHT_MID: Rgb = [0.1, 0.72, 0.48];
const HEIGHT_HIGH: Rgb = [0.96, 0.72, 0.18];

const SLOPE_FLAT: Rgb = [0.08, 0.05, 0.16];
const SLOPE_STEEP: Rgb = [0.98, 0.82, 0.2];

/** Distinct enough that neighboring levels read as different patches. */
const LOD_PALETTE: readonly Rgb[] = [
  [0.86, 0.28, 0.24],
  [0.92, 0.58, 0.16],
  [0.93, 0.84, 0.28],
  [0.42, 0.74, 0.32],
  [0.22, 0.7, 0.7],
  [0.28, 0.46, 0.9],
  [0.56, 0.36, 0.86],
  [0.86, 0.4, 0.68],
];

/** Slopes of a few degrees are typical at the default amplitude. This maps them across the ramp. */
const SLOPE_RAMP_RADIANS = 0.2;

/**
 * Rock starts around 16° and fully replaces the ground color by about 41°.
 * The terrain shader uses the same window so the lit view matches this helper.
 */
const SLOPE_ROCK_START = 0.28;
const SLOPE_ROCK_END = 0.72;

function lerp(a: Rgb, b: Rgb, t: number): Rgb {
  const u = clamp(t, 0, 1);
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

function terrainColor(params: PlanetParams, sample: ColorSample, slope: number): Rgb {
  const shoreWidth = shoreWidthMeters(params.radius, params.amplitude);
  if (sample.seaRelativeHeight < 0) {
    const depth = clamp(-sample.seaRelativeHeight / Math.max(params.amplitude, 1), 0, 1);
    return lerp(OCEAN_SHALLOW, OCEAN_DEEP, depth);
  }
  if (sample.seaRelativeHeight < shoreWidth) {
    return SHORE;
  }
  const landSpan = Math.max(params.amplitude - shoreWidth, 1);
  const t = clamp((sample.seaRelativeHeight - shoreWidth) / landSpan, 0, 1);
  const ground =
    t < 0.45 ? lerp(LAND, HIGHLAND, t / 0.45) : lerp(HIGHLAND, SNOW, (t - 0.45) / 0.55);
  // Steep faces shed the biome tint. Beaches and ocean stay put so a cliff
  // at the waterline does not turn the shallows into rock.
  return lerp(ground, ROCK, smoothstep(SLOPE_ROCK_START, SLOPE_ROCK_END, slope));
}

function heightColor(params: PlanetParams, sample: ColorSample): Rgb {
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

const TEMPERATURE_COLD = -45;
const TEMPERATURE_HOT = 40;

function temperatureColor(temperature: number): Rgb {
  const t = clamp((temperature - TEMPERATURE_COLD) / (TEMPERATURE_HOT - TEMPERATURE_COLD), 0, 1);
  if (t < 0.45) return lerp([0.12, 0.28, 0.85], [0.55, 0.86, 0.9], t / 0.45);
  if (t < 0.7) return lerp([0.55, 0.86, 0.9], [0.95, 0.82, 0.28], (t - 0.45) / 0.25);
  return lerp([0.95, 0.82, 0.28], [0.85, 0.18, 0.12], (t - 0.7) / 0.3);
}

function moistureColor(moisture: number): Rgb {
  const t = clamp(moisture, 0, 1);
  if (t < 0.5) return lerp([0.55, 0.38, 0.18], [0.2, 0.55, 0.32], t / 0.5);
  return lerp([0.2, 0.55, 0.32], [0.1, 0.28, 0.72], (t - 0.5) / 0.5);
}

function windColor(sample: ColorSample): Rgb {
  const x = sample.windX ?? 0;
  const y = sample.windY ?? 0;
  const z = sample.windZ ?? 0;
  const magnitude = Math.hypot(x, y, z);
  if (magnitude < 1e-4) return [0.12, 0.12, 0.16];
  return [(x / magnitude) * 0.5 + 0.5, (y / magnitude) * 0.5 + 0.5, (z / magnitude) * 0.5 + 0.5];
}

function rainfallColor(rainfall: number): Rgb {
  const t = clamp(rainfall / 0.35, 0, 1);
  return lerp([0.08, 0.06, 0.08], [0.15, 0.75, 0.92], t);
}

function biomeColor(sample: ColorSample): Rgb {
  const primary = BIOMES[sample.biomeId ?? 0] ?? BIOMES[0];
  const secondary = BIOMES[sample.secondaryBiomeId ?? primary.index] ?? primary;
  const weight = sample.biomeWeight ?? 1;
  return lerp(secondary.color, primary.color, weight);
}

function materialColor(sample: ColorSample): Rgb {
  const index = sample.materialId ?? 0;
  return MATERIALS.find((material) => material.index === index)?.color ?? MATERIALS[0].color;
}

export function colorForChannel(
  channel: DebugChannelId,
  params: PlanetParams,
  sample: ColorSample,
  slope: number,
  lod = 0,
): Rgb {
  switch (channel) {
    case "terrain":
      return terrainColor(params, sample, slope);
    case "height":
      return heightColor(params, sample);
    case "slope":
      return slopeColor(slope);
    case "lod":
      return LOD_PALETTE[Math.abs(Math.trunc(lod)) % LOD_PALETTE.length] ?? LOD_PALETTE[0];
    case "temperature":
      return temperatureColor(sample.temperature ?? 0);
    case "moisture":
      return moistureColor(sample.moisture ?? 0);
    case "wind":
      return windColor(sample);
    case "rainfall":
      return rainfallColor(sample.rainfall ?? 0);
    case "biome":
      return biomeColor(sample);
    case "material":
      return materialColor(sample);
    default: {
      const unknown: never = channel;
      throw new Error(`Unknown debug channel "${String(unknown)}"`);
    }
  }
}
