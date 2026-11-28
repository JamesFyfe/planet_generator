import { PLANET_PARAM_REGISTRY, clampPlanetParam, defaultPlanetParams } from "./params";
import type { PlanetParamKey, PlanetParams } from "./params";

export type PlanetPresetValues = { [K in Exclude<PlanetParamKey, "seed">]: number };

export interface PlanetPreset {
  id: string;
  label: string;
  summary: string;
  values: PlanetPresetValues;
}

function presetValues(overrides: Partial<PlanetPresetValues> = {}): PlanetPresetValues {
  const defaults = defaultPlanetParams();
  const values = {} as PlanetPresetValues;
  for (const meta of PLANET_PARAM_REGISTRY) {
    if (meta.key === "seed") continue;
    const override = overrides[meta.key];
    values[meta.key] = override === undefined ? defaults[meta.key] : override;
  }
  return values;
}

/**
 * Terrain looks. Seed stays with the caller so the same planet can be
 * restyled. Climate sliders stay at their defaults. Plates and features are later phases.
 */
export const PLANET_PRESETS = [
  {
    id: "earthlike",
    label: "Earthlike",
    summary: "Continents, coastal ranges, and a shoreline near the mean height.",
    values: presetValues(),
  },
  {
    id: "highlands",
    label: "Highlands",
    summary: "Broad land and tall ridged ranges, with little open ocean.",
    values: presetValues({
      amplitude: 9_000,
      seaLevel: -1_200,
      continentScale: 1.1,
      continentStrength: 0.46,
      coastBias: -0.18,
      mountainScale: 3.2,
      mountainOctaves: 6,
      mountainStrength: 0.85,
      mountainLandBias: 1,
      hillStrength: 0.12,
      detailStrength: 0.08,
      warpStrength: 0.08,
    }),
  },
  {
    id: "archipelago",
    label: "Archipelago",
    summary: "Flooded lowlands, warped island chains, and short coastal peaks.",
    values: presetValues({
      amplitude: 3_200,
      seaLevel: 700,
      continentScale: 2.4,
      continentOctaves: 5,
      continentStrength: 0.62,
      coastBias: 0.28,
      mountainScale: 5,
      mountainOctaves: 4,
      mountainStrength: 0.42,
      mountainLandBias: 0.7,
      hillScale: 12,
      hillOctaves: 4,
      hillStrength: 0.28,
      detailScale: 24,
      detailOctaves: 3,
      detailStrength: 0.1,
      warpStrength: 0.45,
      warpScale: 1.8,
    }),
  },
] as const satisfies readonly PlanetPreset[];

export type PlanetPresetId = (typeof PLANET_PRESETS)[number]["id"];

export function planetPreset(id: string): PlanetPreset | undefined {
  return PLANET_PRESETS.find((preset) => preset.id === id);
}

export function matchingPlanetPreset(params: PlanetParams): PlanetPreset | undefined {
  return PLANET_PRESETS.find((preset) => {
    for (const key of Object.keys(preset.values) as (keyof PlanetPresetValues)[]) {
      if (params[key] !== preset.values[key]) return false;
    }
    return true;
  });
}

/** Applies every preset value except the seed, then clamps to the registry. */
export function applyPlanetPreset(current: PlanetParams, preset: PlanetPreset): PlanetParams {
  const next: PlanetParams = { ...current, ...preset.values };
  for (const meta of PLANET_PARAM_REGISTRY) {
    if (meta.key === "seed") continue;
    next[meta.key] = clampPlanetParam(meta.key, next[meta.key]);
  }
  return next;
}
