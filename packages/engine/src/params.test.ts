import { describe, expect, it } from "vitest";
import {
  PLANET_PARAM_REGISTRY,
  PLANET_PARAMS_VERSION,
  clampPlanetParam,
  defaultPlanetParams,
  isPlanetParamKey,
  paramMeta,
} from "./index";

describe("planet parameter registry", () => {
  it("lists a parameter for every terrain layer", () => {
    expect(PLANET_PARAM_REGISTRY.map((param) => param.key)).toEqual([
      "seed",
      "radius",
      "continentScale",
      "continentOctaves",
      "continentStrength",
      "coastBias",
      "mountainScale",
      "mountainOctaves",
      "mountainStrength",
      "mountainLandBias",
      "hillScale",
      "hillOctaves",
      "hillStrength",
      "detailScale",
      "detailOctaves",
      "detailStrength",
      "warpStrength",
      "warpScale",
      "amplitude",
      "seaLevel",
    ]);
    expect(new Set(PLANET_PARAM_REGISTRY.map((param) => param.group))).toEqual(
      new Set(["World", "Continents", "Mountains", "Hills", "Detail", "Warp", "Surface"]),
    );
  });

  it("gives every registered parameter valid metadata", () => {
    const keys = new Set<string>();
    for (const param of PLANET_PARAM_REGISTRY) {
      expect(keys.has(param.key)).toBe(false);
      keys.add(param.key);
      expect(param.label.trim().length).toBeGreaterThan(0);
      expect(param.group.trim().length).toBeGreaterThan(0);
      expect(Number.isFinite(param.min)).toBe(true);
      expect(Number.isFinite(param.max)).toBe(true);
      expect(Number.isFinite(param.default)).toBe(true);
      expect(Number.isFinite(param.step)).toBe(true);
      expect(param.min).toBeLessThan(param.max);
      expect(param.default).toBeGreaterThanOrEqual(param.min);
      expect(param.default).toBeLessThanOrEqual(param.max);
      expect(param.step).toBeGreaterThan(0);
      expect(param.step).toBeLessThanOrEqual(param.max - param.min);
    }
  });

  it("uses meters for the radius default from the build plan", () => {
    expect(paramMeta("radius")).toMatchObject({
      min: 5_000,
      max: 500_000,
      default: 50_000,
    });
  });

  it("builds a versioned, serializable default object", () => {
    const params = defaultPlanetParams();
    expect(params.version).toBe(PLANET_PARAMS_VERSION);
    for (const param of PLANET_PARAM_REGISTRY) {
      expect(params[param.key]).toBe(param.default);
    }
    expect(JSON.parse(JSON.stringify(params))).toEqual(params);
  });

  it("clamps out-of-range values and replaces non-finite ones", () => {
    expect(clampPlanetParam("radius", 1)).toBe(5_000);
    expect(clampPlanetParam("radius", 9_000_000)).toBe(500_000);
    expect(clampPlanetParam("continentScale", 2.5)).toBe(2.5);
    expect(clampPlanetParam("seed", Number.NaN)).toBe(1);
    expect(clampPlanetParam("amplitude", -10)).toBe(0);
    expect(clampPlanetParam("amplitude", 50_000)).toBe(20_000);
    expect(clampPlanetParam("seaLevel", 250)).toBe(250);
    expect(clampPlanetParam("mountainOctaves", 0)).toBe(1);
    expect(clampPlanetParam("mountainOctaves", 40)).toBe(8);
    expect(clampPlanetParam("warpStrength", 4)).toBe(0.75);
    expect(clampPlanetParam("coastBias", Number.POSITIVE_INFINITY)).toBe(0.08);
    expect(isPlanetParamKey("radius")).toBe(true);
    expect(isPlanetParamKey("seaLevel")).toBe(true);
    expect(isPlanetParamKey("mountainStrength")).toBe(true);
    expect(isPlanetParamKey("noiseScale")).toBe(false);
    expect(isPlanetParamKey("biome")).toBe(false);
  });
});
