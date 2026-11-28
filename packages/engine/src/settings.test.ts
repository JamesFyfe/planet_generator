import { describe, expect, it } from "vitest";
import {
  PLANET_PARAM_REGISTRY,
  PLANET_PARAMS_VERSION,
  decodePlanetQuery,
  defaultPlanetParams,
  encodePlanetQuery,
  planetParamsFromJson,
  planetParamsToJson,
  type PlanetParams,
} from "./index";

function variedParams(): PlanetParams {
  const params = defaultPlanetParams();
  for (const meta of PLANET_PARAM_REGISTRY) {
    params[meta.key] = meta.min === meta.default ? meta.max : meta.min;
  }
  params.seed = 42;
  return params;
}

describe("shareable settings", () => {
  it("round-trips seed and every non-default parameter through the query string", () => {
    const params = variedParams();
    const encoded = encodePlanetQuery(params);
    expect(encoded.startsWith(`v=${PLANET_PARAMS_VERSION}&seed=42`)).toBe(true);
    expect(decodePlanetQuery(encoded)).toEqual(params);
    expect(decodePlanetQuery(`?${encoded}`)).toEqual(params);
    for (const meta of PLANET_PARAM_REGISTRY) {
      if (meta.key === "seed" || params[meta.key] === meta.default) continue;
      expect(encoded).toContain(`${meta.key}=${params[meta.key]}`);
    }
  });

  it("omits default parameters other than the seed and restores them on decode", () => {
    const defaults = defaultPlanetParams();
    expect(encodePlanetQuery(defaults)).toBe(`v=${PLANET_PARAMS_VERSION}&seed=${defaults.seed}`);
    expect(decodePlanetQuery("")).toEqual(defaults);
    expect(decodePlanetQuery("?")).toEqual(defaults);
    const encoded = encodePlanetQuery({ ...defaults, seaLevel: -200, mountainStrength: 0.8 });
    expect(encoded).not.toContain("continentScale");
    expect(encoded).not.toContain("radius");
    expect(decodePlanetQuery(encoded)).toEqual({
      ...defaults,
      seaLevel: -200,
      mountainStrength: 0.8,
    });
  });

  it("clamps query values and ignores keys from the old single noise layer", () => {
    const decoded = decodePlanetQuery("v=2&seed=999999999&radius=1&noiseScale=4&octaves=9");
    expect(decoded.version).toBe(PLANET_PARAMS_VERSION);
    expect(decoded.seed).toBe(1_000_000);
    expect(decoded.radius).toBe(5_000);
    expect(decoded.continentScale).toBe(defaultPlanetParams().continentScale);
    expect("noiseScale" in decoded).toBe(false);
  });

  it("round-trips settings JSON and fills missing keys from the registry", () => {
    const params = variedParams();
    expect(planetParamsFromJson(planetParamsToJson(params))).toEqual(params);
    expect(planetParamsFromJson('{"seed":12,"warpStrength":0}')).toEqual({
      ...defaultPlanetParams(),
      seed: 12,
      warpStrength: 0,
    });
    expect(() => planetParamsFromJson("{")).toThrow(/JSON/);
    expect(() => planetParamsFromJson("[]")).toThrow(/JSON object/);
  });
});
