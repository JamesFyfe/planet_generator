import type { PlanetParams } from "./params";
import type { PlanetSample } from "./sample";
import { CONTINENT_SHELF_M, OCEAN_BASIN_M, tectonicActivity } from "./tectonics/fields";
import { BoundaryKind, CrustKind } from "./tectonics/plates";
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
 * Named color outputs. The explorer builds its dropdown from this list.
 * Tectonic channels are unlit so the plate and boundary colors stay flat.
 */
export const DEBUG_CHANNEL_REGISTRY = [
  { id: "terrain", label: "Terrain", lit: true },
  { id: "height", label: "Height", lit: false },
  { id: "slope", label: "Slope", lit: false },
  { id: "lod", label: "LOD", lit: false },
  { id: "plate", label: "Plates", lit: false },
  { id: "boundary", label: "Boundaries", lit: false },
  { id: "uplift", label: "Uplift", lit: false },
  { id: "crust", label: "Crust", lit: false },
  { id: "hotspot", label: "Hotspots", lit: false },
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
  const activity = tectonicActivity(params);
  const shoreWidth = Math.max(
    Math.min(params.radius * SHORE_RADIUS_FRACTION, params.amplitude * SHORE_AMPLITUDE_FRACTION),
    1,
  );
  if (sample.seaRelativeHeight < 0) {
    // Basins and trenches, not the detail amplitude, set how deep the blue goes.
    const oceanSpan = Math.max(
      OCEAN_BASIN_M + Math.max(0, params.riftDepth) * activity,
      Math.abs(params.amplitude),
      1,
    );
    const depth = clamp(-sample.seaRelativeHeight / oceanSpan, 0, 1);
    return lerp(OCEAN_SHALLOW, OCEAN_DEEP, depth);
  }
  if (sample.seaRelativeHeight < shoreWidth) {
    return SHORE;
  }
  // Shelves stay green; only the mountain contribution reaches snow.
  const landSpan = Math.max(
    CONTINENT_SHELF_M + Math.max(0, params.mountainHeight) * activity,
    Math.abs(params.amplitude),
    1,
  );
  const t = clamp((sample.seaRelativeHeight - shoreWidth) / landSpan, 0, 1);
  if (t < 0.45) return lerp(LAND, HIGHLAND, t / 0.45);
  return lerp(HIGHLAND, SNOW, (t - 0.45) / 0.55);
}

function heightColor(params: PlanetParams, sample: PlanetSample): Rgb {
  // The full relief span pins ordinary shelves near the middle, so this ramp
  // covers the shelf contrast and only a slice of the boundary extremes.
  // Peaks and trenches then sit at the ends instead of next to the basins.
  const activity = tectonicActivity(params);
  const boundary =
    (Math.max(0, params.mountainHeight) + Math.max(0, params.riftDepth)) * activity * 0.2;
  const span = Math.max(
    CONTINENT_SHELF_M + OCEAN_BASIN_M + boundary + Math.abs(params.amplitude) * 0.25,
    1,
  );
  const centered = clamp(sample.seaRelativeHeight / span, -1, 1);
  const t = (centered + 1) / 2;
  if (t < 0.5) return lerp(HEIGHT_LOW, HEIGHT_MID, t / 0.5);
  return lerp(HEIGHT_MID, HEIGHT_HIGH, (t - 0.5) / 0.5);
}

function hsl(hue: number, saturation: number, light: number): Rgb {
  const h = ((hue % 1) + 1) % 1;
  const c = (1 - Math.abs(2 * light - 1)) * saturation;
  const hp = h * 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const sector = Math.floor(hp);
  const rgb =
    sector === 0
      ? [c, x, 0]
      : sector === 1
        ? [x, c, 0]
        : sector === 2
          ? [0, c, x]
          : sector === 3
            ? [0, x, c]
            : sector === 4
              ? [x, 0, c]
              : [c, 0, x];
  const m = light - c / 2;
  return [(rgb[0] ?? 0) + m, (rgb[1] ?? 0) + m, (rgb[2] ?? 0) + m];
}

function plateColor(plateId: number): Rgb {
  const hue = (Math.abs(Math.trunc(plateId)) * 0.61803398875) % 1;
  return hsl(hue, 0.62, 0.52);
}

const BOUNDARY_INTERIOR: Rgb = [0.12, 0.13, 0.16];
const BOUNDARY_COLORS: Readonly<Record<number, Rgb>> = {
  [BoundaryKind.transform]: [0.93, 0.88, 0.28],
  [BoundaryKind.rift]: [0.95, 0.55, 0.16],
  [BoundaryKind.ridge]: [0.2, 0.78, 0.74],
  [BoundaryKind.collision]: [0.9, 0.28, 0.22],
  [BoundaryKind.subduction]: [0.58, 0.32, 0.86],
};

/** Bands fade out so the interior of a plate does not look like a boundary. */
const BOUNDARY_BAND_RADIANS = 0.2;

function boundaryColor(sample: PlanetSample): Rgb {
  const color = BOUNDARY_COLORS[sample.boundary] ?? BOUNDARY_INTERIOR;
  const fade = clamp(1 - sample.boundaryDistance / BOUNDARY_BAND_RADIANS, 0, 1);
  return lerp(BOUNDARY_INTERIOR, color, fade);
}

const UPLIFT_DOWN: Rgb = [0.15, 0.35, 0.85];
const UPLIFT_ZERO: Rgb = [0.18, 0.18, 0.2];
const UPLIFT_UP: Rgb = [0.92, 0.45, 0.16];

function upliftColor(params: PlanetParams, sample: PlanetSample): Rgb {
  const span = Math.max(params.mountainHeight, params.riftDepth, 1);
  const t = clamp(sample.uplift / span, -1, 1);
  if (t < 0) return lerp(UPLIFT_ZERO, UPLIFT_DOWN, -t);
  return lerp(UPLIFT_ZERO, UPLIFT_UP, t);
}

function crustColor(crust: number): Rgb {
  return crust === CrustKind.continental ? [0.74, 0.58, 0.32] : [0.1, 0.28, 0.58];
}

const HOTSPOT_BASE: Rgb = [0.05, 0.06, 0.1];
const HOTSPOT_HOT: Rgb = [1, 0.86, 0.35];

function hotspotColor(sample: PlanetSample): Rgb {
  return lerp(HOTSPOT_BASE, HOTSPOT_HOT, sample.hotspot);
}

function slopeColor(slope: number): Rgb {
  return lerp(SLOPE_FLAT, SLOPE_STEEP, slope / SLOPE_RAMP_RADIANS);
}

export function colorForChannel(
  channel: DebugChannelId,
  params: PlanetParams,
  sample: PlanetSample,
  slope: number,
  lod = 0,
): Rgb {
  switch (channel) {
    case "terrain":
      return terrainColor(params, sample);
    case "height":
      return heightColor(params, sample);
    case "slope":
      return slopeColor(slope);
    case "lod":
      return LOD_PALETTE[Math.abs(Math.trunc(lod)) % LOD_PALETTE.length] ?? LOD_PALETTE[0];
    case "plate":
      return plateColor(sample.plateId);
    case "boundary":
      return boundaryColor(sample);
    case "uplift":
      return upliftColor(params, sample);
    case "crust":
      return crustColor(sample.crust);
    case "hotspot":
      return hotspotColor(sample);
    default: {
      const unknown: never = channel;
      throw new Error(`Unknown debug channel "${String(unknown)}"`);
    }
  }
}
