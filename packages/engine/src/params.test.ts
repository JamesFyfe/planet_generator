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
  it("lists the phase 1 terrain parameters", () => {
    expect(PLANET_PARAM_REGISTRY.map((param) => param.key)).toEqual([
      "seed",
      "radius",
      "noiseScale",
      "octaves",
      "amplitude",
      "seaLevel",
    ]);
  });

  it("keeps every default inside its slider range", () => {
    const keys = new Set<string>();
    for (const param of PLANET_PARAM_REGISTRY) {
      expect(keys.has(param.key)).toBe(false);
      keys.add(param.key);
      expect(param.label.length).toBeGreaterThan(0);
      expect(param.group.length).toBeGreaterThan(0);
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
    expect(params).toEqual({
      version: 2,
      seed: 1,
      radius: 50_000,
      noiseScale: 1,
      octaves: 5,
      amplitude: 3_000,
      seaLevel: 0,
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual(params);
  });

  it("clamps out-of-range values and replaces non-finite ones", () => {
    expect(clampPlanetParam("radius", 1)).toBe(5_000);
    expect(clampPlanetParam("radius", 9_000_000)).toBe(500_000);
    expect(clampPlanetParam("noiseScale", 2.5)).toBe(2.5);
    expect(clampPlanetParam("seed", Number.NaN)).toBe(1);
    expect(clampPlanetParam("amplitude", -10)).toBe(0);
    expect(clampPlanetParam("amplitude", 50_000)).toBe(20_000);
    expect(clampPlanetParam("seaLevel", 250)).toBe(250);
    expect(clampPlanetParam("octaves", 0)).toBe(1);
    expect(clampPlanetParam("octaves", 40)).toBe(8);
    expect(isPlanetParamKey("radius")).toBe(true);
    expect(isPlanetParamKey("seaLevel")).toBe(true);
    expect(isPlanetParamKey("biome")).toBe(false);
  });
});
