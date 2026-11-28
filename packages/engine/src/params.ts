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
 * Radius, amplitude, sea level, and the atmosphere lengths are meters.
 * 50 km is the default radius, with the plan's 5 km–500 km range.
 * Octaves stay under the fBm cap of 16.
 * Rayleigh and Mie values are coefficients in 1e-6 per meter. Density scales
 * them in the renderer. Zero density is an airless body. Terrain sampling
 * does not read the atmosphere, cloud, or motion fields, so those sliders
 * do not change the height field.
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
    key: "atmosphereDensity",
    label: "Density",
    min: 0,
    max: 4,
    default: 1,
    step: 0.05,
    group: "Atmosphere",
  },
  {
    key: "atmosphereScaleHeight",
    label: "Scale height (m)",
    min: 100,
    max: 30_000,
    default: 2_000,
    step: 50,
    group: "Atmosphere",
  },
  {
    key: "atmosphereThickness",
    label: "Thickness (m)",
    min: 0,
    max: 80_000,
    default: 8_000,
    step: 100,
    group: "Atmosphere",
  },
  {
    key: "rayleighR",
    label: "Rayleigh R",
    min: 0,
    max: 800,
    default: 50,
    step: 1,
    group: "Atmosphere",
  },
  {
    key: "rayleighG",
    label: "Rayleigh G",
    min: 0,
    max: 800,
    default: 110,
    step: 1,
    group: "Atmosphere",
  },
  {
    key: "rayleighB",
    label: "Rayleigh B",
    min: 0,
    max: 1_200,
    default: 225,
    step: 1,
    group: "Atmosphere",
  },
  {
    key: "mieStrength",
    label: "Mie strength",
    min: 0,
    max: 200,
    default: 20,
    step: 0.5,
    group: "Atmosphere",
  },
  {
    key: "cloudDensity",
    label: "Cloud density",
    min: 0,
    max: 1,
    default: 0.65,
    step: 0.01,
    group: "Clouds",
  },
  {
    key: "cloudCoverage",
    label: "Coverage",
    min: 0,
    max: 1,
    default: 0.48,
    step: 0.01,
    group: "Clouds",
  },
  {
    key: "axialTilt",
    label: "Axial tilt (°)",
    min: -90,
    max: 90,
    default: 23.4,
    step: 0.1,
    group: "Motion",
  },
  {
    key: "rotationPeriod",
    label: "Rotation (h)",
    min: 0.5,
    max: 240,
    default: 24,
    step: 0.5,
    group: "Motion",
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
