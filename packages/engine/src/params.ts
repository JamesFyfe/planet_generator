export const PLANET_PARAMS_VERSION = 1;

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
 * Radius is meters. 50 km is the default, with the plan's 5 km–500 km range.
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
