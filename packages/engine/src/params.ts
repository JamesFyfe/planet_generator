/** 3 adds the tectonic sliders. The cubemap is keyed by those fields. */
export const PLANET_PARAMS_VERSION = 3;

export interface ParamMeta {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  step: number;
  group: string;
}

/**
 * Slider metadata is the only source for planet parameters. The explorer
 * builds its panel from this list; do not add a parallel set of controls.
 * Radius, amplitude, sea level, mountain height, and rift depth are meters.
 * 50 km is the default radius, with the plan's 5 km–500 km range. Octaves
 * stay under the fBm cap of 16.
 */
export const PLANET_PARAM_REGISTRY = [
  {
    key: "seed",
    label: "Seed",
    min: 0,
    max: 1_000_000,
    default: 1,
    step: 1,
    group: "World",
  },
  {
    key: "radius",
    label: "Radius (m)",
    min: 5_000,
    max: 500_000,
    default: 50_000,
    step: 1_000,
    group: "World",
  },
  {
    key: "noiseScale",
    label: "Noise scale",
    min: 0.1,
    max: 10,
    default: 1,
    step: 0.1,
    group: "Noise",
  },
  {
    key: "octaves",
    label: "Octaves",
    min: 1,
    max: 8,
    default: 5,
    step: 1,
    group: "Noise",
  },
  {
    key: "amplitude",
    label: "Amplitude (m)",
    min: 0,
    max: 20_000,
    default: 3_000,
    step: 100,
    group: "Noise",
  },
  {
    key: "seaLevel",
    label: "Sea level (m)",
    min: -10_000,
    max: 10_000,
    default: 0,
    step: 100,
    group: "Surface",
  },
  {
    key: "plateCount",
    label: "Plate count",
    min: 2,
    max: 40,
    default: 12,
    step: 1,
    group: "Tectonics",
  },
  {
    key: "continentalFraction",
    label: "Continental fraction",
    min: 0,
    max: 1,
    default: 0.35,
    step: 0.01,
    group: "Tectonics",
  },
  {
    key: "tectonicActivity",
    label: "Tectonic activity",
    min: 0,
    max: 2,
    default: 1,
    step: 0.05,
    group: "Tectonics",
  },
  {
    key: "mountainHeight",
    label: "Mountain height (m)",
    min: 0,
    max: 12_000,
    default: 6_000,
    step: 100,
    group: "Tectonics",
  },
  {
    key: "riftDepth",
    label: "Rift depth (m)",
    min: 0,
    max: 8_000,
    default: 2_500,
    step: 100,
    group: "Tectonics",
  },
  {
    key: "boundaryWarp",
    label: "Boundary warp",
    min: 0,
    max: 0.75,
    default: 0.3,
    step: 0.01,
    group: "Tectonics",
  },
  {
    key: "hotspotCount",
    label: "Hotspot count",
    min: 0,
    max: 24,
    default: 5,
    step: 1,
    group: "Tectonics",
  },
] as const satisfies readonly ParamMeta[];

export type PlanetParamKey = (typeof PLANET_PARAM_REGISTRY)[number]["key"];

export type PlanetParams = { version: typeof PLANET_PARAMS_VERSION } & {
  [K in PlanetParamKey]: number;
};

const META_BY_KEY = new Map<PlanetParamKey, ParamMeta>(
  PLANET_PARAM_REGISTRY.map((param) => [param.key, param]),
);

export function isPlanetParamKey(key: string): key is PlanetParamKey {
  return META_BY_KEY.has(key as PlanetParamKey);
}

export function paramMeta(key: PlanetParamKey): ParamMeta {
  const meta = META_BY_KEY.get(key);
  if (!meta) {
    throw new Error(`Unknown planet parameter "${key}"`);
  }
  return meta;
}

export function defaultPlanetParams(): PlanetParams {
  const values = {} as { [K in PlanetParamKey]: number };
  for (const param of PLANET_PARAM_REGISTRY) {
    values[param.key] = param.default;
  }
  return { version: PLANET_PARAMS_VERSION, ...values };
}

export function clampPlanetParam(key: PlanetParamKey, value: number): number {
  const meta = paramMeta(key);
  if (!Number.isFinite(value)) return meta.default;
  return Math.min(meta.max, Math.max(meta.min, value));
}
