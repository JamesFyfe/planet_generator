export const PLANET_PARAMS_VERSION = 4;

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
 * Radius, relief, and sea level are meters. 50 km is the default radius,
 * with the plan's 5 km–500 km range. Octave counts stay under the fBm cap of 16.
 *
 * Version 3 replaces the single noise layer (`noiseScale`, `octaves`) with
 * one scale, octave count, and strength per terrain layer.
 * Version 4 adds the climate sliders. Star distance is relative to the
 * default insolation (1). Tilt is degrees. Temperatures elsewhere are °C.
 */
export const PLANET_PARAM_REGISTRY = [
  {
    key: "seed",
    label: "Seed",
    min: 0,
    max: 1_000_000,
    step: 1,
    default: 1,
    group: "World",
  },
  {
    key: "radius",
    label: "Radius (m)",
    min: 5_000,
    max: 500_000,
    step: 1_000,
    default: 50_000,
    group: "World",
  },
  {
    key: "continentScale",
    label: "Scale",
    min: 0.4,
    max: 6,
    step: 0.1,
    default: 1.4,
    group: "Continents",
  },
  {
    key: "continentOctaves",
    label: "Octaves",
    min: 1,
    max: 6,
    step: 1,
    default: 4,
    group: "Continents",
  },
  {
    key: "continentStrength",
    label: "Strength",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.55,
    group: "Continents",
  },
  {
    key: "coastBias",
    label: "Coast bias",
    min: -0.5,
    max: 0.5,
    step: 0.01,
    default: 0.08,
    group: "Continents",
  },
  {
    key: "mountainScale",
    label: "Scale",
    min: 1,
    max: 12,
    step: 0.1,
    default: 3.5,
    group: "Mountains",
  },
  {
    key: "mountainOctaves",
    label: "Octaves",
    min: 1,
    max: 8,
    step: 1,
    default: 5,
    group: "Mountains",
  },
  {
    key: "mountainStrength",
    label: "Strength",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.4,
    group: "Mountains",
  },
  {
    key: "mountainLandBias",
    label: "Land bias",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.9,
    group: "Mountains",
  },
  {
    key: "hillScale",
    label: "Scale",
    min: 2,
    max: 20,
    step: 0.1,
    default: 8,
    group: "Hills",
  },
  {
    key: "hillOctaves",
    label: "Octaves",
    min: 1,
    max: 6,
    step: 1,
    default: 3,
    group: "Hills",
  },
  {
    key: "hillStrength",
    label: "Strength",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.16,
    group: "Hills",
  },
  {
    key: "detailScale",
    label: "Scale",
    min: 6,
    max: 40,
    step: 0.5,
    default: 18,
    group: "Detail",
  },
  {
    key: "detailOctaves",
    label: "Octaves",
    min: 1,
    max: 4,
    step: 1,
    default: 2,
    group: "Detail",
  },
  {
    key: "detailStrength",
    label: "Strength",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.05,
    group: "Detail",
  },
  {
    key: "warpStrength",
    label: "Strength",
    min: 0,
    max: 0.75,
    step: 0.01,
    default: 0.18,
    group: "Warp",
  },
  {
    key: "warpScale",
    label: "Scale",
    min: 0.4,
    max: 6,
    step: 0.1,
    default: 1.1,
    group: "Warp",
  },
  {
    key: "amplitude",
    label: "Relief (m)",
    min: 0,
    max: 20_000,
    step: 100,
    default: 4_000,
    group: "Surface",
  },
  {
    key: "seaLevel",
    label: "Sea level (m)",
    min: -10_000,
    max: 10_000,
    step: 100,
    default: 0,
    group: "Surface",
  },
  {
    key: "atmosphereDensity",
    label: "Density",
    min: 0,
    max: 4,
    step: 0.05,
    default: 1,
    group: "Atmosphere",
  },
  {
    key: "axialTilt",
    label: "Axial tilt (°)",
    min: -90,
    max: 90,
    step: 0.1,
    default: 23.4,
    group: "Motion",
  },
  {
    key: "starDistance",
    label: "Star distance",
    min: 0.4,
    max: 2.5,
    step: 0.01,
    default: 1,
    group: "Climate",
  },
  {
    key: "temperatureOffset",
    label: "Temperature offset (°C)",
    min: -40,
    max: 40,
    step: 1,
    default: 0,
    group: "Climate",
  },
  {
    key: "globalMoisture",
    label: "Moisture",
    min: 0,
    max: 2,
    step: 0.01,
    default: 1,
    group: "Climate",
  },
  {
    key: "windStrength",
    label: "Wind",
    min: 0,
    max: 2,
    step: 0.01,
    default: 1,
    group: "Climate",
  },
  {
    key: "biomeSharpness",
    label: "Biome sharpness",
    min: 0.25,
    max: 8,
    step: 0.05,
    default: 2,
    group: "Climate",
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
