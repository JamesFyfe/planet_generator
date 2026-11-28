import { PLANET_PARAM_REGISTRY, clampPlanetParam, defaultPlanetParams } from "./params";
import type { PlanetParamKey, PlanetParams } from "./params";

/**
 * Query form: `v` plus `seed`, then any other parameter that is not its
 * registry default, in registry order. Omitted keys decode back to defaults,
 * so a shared link stays short and still rebuilds the same planet.
 * Values are clamped before encoding so a bad number cannot survive the round trip.
 */
export function encodePlanetQuery(params: PlanetParams): string {
  const normalized = applyKnownParams((key) => params[key]);
  const parts = [`v=${normalized.version}`, `seed=${normalized.seed}`];
  for (const meta of PLANET_PARAM_REGISTRY) {
    if (meta.key === "seed") continue;
    const value = normalized[meta.key];
    if (value === meta.default) continue;
    parts.push(`${meta.key}=${value}`);
  }
  return parts.join("&");
}

export function decodePlanetQuery(query: string): PlanetParams {
  const source = query.startsWith("?") ? query.slice(1) : query;
  if (source.length === 0) return defaultPlanetParams();
  const parsed = new URLSearchParams(source);
  return applyKnownParams((key) => {
    const raw = parsed.get(key);
    if (raw === null || raw.trim() === "") return undefined;
    return Number(raw);
  });
}

export function planetParamsToJson(params: PlanetParams): string {
  return `${JSON.stringify(params, null, 2)}\n`;
}

export function planetParamsFromJson(text: string): PlanetParams {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Settings file is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Settings file must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  return applyKnownParams((key) => {
    const value = record[key];
    return typeof value === "number" ? value : undefined;
  });
}

function applyKnownParams(read: (key: PlanetParamKey) => number | undefined): PlanetParams {
  const params = defaultPlanetParams();
  for (const meta of PLANET_PARAM_REGISTRY) {
    const value = read(meta.key);
    if (value === undefined) continue;
    params[meta.key] = clampPlanetParam(meta.key, value);
  }
  return params;
}
