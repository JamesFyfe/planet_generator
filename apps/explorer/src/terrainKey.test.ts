import { defaultPlanetParams } from "@planet/engine";
import { describe, expect, it } from "vitest";
import { terrainCacheKey } from "./terrainKey";

describe("terrain cache key", () => {
  it("ignores atmosphere and motion parameters", () => {
    const base = terrainCacheKey("terrain", defaultPlanetParams());
    const visual = terrainCacheKey("terrain", {
      ...defaultPlanetParams(),
      atmosphereDensity: 0,
      rayleighB: 4,
      cloudCoverage: 0.1,
      axialTilt: 0,
      rotationPeriod: 8,
    });
    expect(visual).toBe(base);
    expect(terrainCacheKey("terrain", { ...defaultPlanetParams(), seaLevel: 200 })).not.toBe(base);
    expect(terrainCacheKey("height", defaultPlanetParams())).not.toBe(base);
  });
});
