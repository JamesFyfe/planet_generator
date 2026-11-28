import { describe, expect, it } from "vitest";
import {
  PLANET_PARAM_REGISTRY,
  PLANET_PRESETS,
  applyPlanetPreset,
  createPlanet,
  defaultPlanetParams,
  matchingPlanetPreset,
  type PlanetParams,
} from "./index";
import type { Vec3 } from "./noise/domainWarp";

const DIRECTIONS: Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: 0.2, y: -0.4, z: 0.5 },
  { x: -0.3, y: 0.8, z: -0.2 },
  { x: 0, y: 1, z: 0 },
  { x: 0.4, y: 0.2, z: 0.9 },
];

function heights(params: PlanetParams): number[] {
  const planet = createPlanet(params);
  return DIRECTIONS.map((dir) => planet.sample(dir).height);
}

describe("layered terrain", () => {
  it("is deterministic for the same seed and params", () => {
    const params = defaultPlanetParams();
    const first = heights(params);
    heights({ ...params, seed: 99 });
    expect(heights(params)).toEqual(first);
    expect(first.every((height) => Number.isFinite(height))).toBe(true);
  });

  it("changes when any layer weight, scale, or the warp changes", () => {
    const base = heights(defaultPlanetParams());
    const patches: Partial<PlanetParams>[] = [
      { continentStrength: 0 },
      { mountainStrength: 0 },
      { hillStrength: 0 },
      { detailStrength: 0 },
      { warpStrength: 0 },
      { continentScale: 4 },
      { mountainScale: 8 },
      { hillScale: 16 },
      { detailScale: 32 },
      { coastBias: -0.4 },
      { mountainLandBias: 0 },
    ];
    for (const patch of patches) {
      expect(heights({ ...defaultPlanetParams(), ...patch })).not.toEqual(base);
    }
  });

  it("stays inside the relief and is flat when every layer is off", () => {
    const params = defaultPlanetParams();
    for (const height of heights(params)) {
      expect(height).toBeGreaterThanOrEqual(-params.amplitude);
      expect(height).toBeLessThanOrEqual(params.amplitude);
    }
    const silent = heights({
      ...params,
      continentStrength: 0,
      mountainStrength: 0,
      hillStrength: 0,
      detailStrength: 0,
    });
    expect(silent).toEqual([0, 0, 0, 0, 0]);
  });

  it("keeps both ocean and land at the default settings", () => {
    const planet = createPlanet(defaultPlanetParams());
    const count = 96;
    const golden = Math.PI * (3 - Math.sqrt(5));
    let land = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < count; i++) {
      const y = 1 - (2 * i) / (count - 1);
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      const sample = planet.sample({
        x: Math.cos(theta) * ring,
        y,
        z: Math.sin(theta) * ring,
      });
      if (sample.seaRelativeHeight >= 0) land += 1;
      min = Math.min(min, sample.height);
      max = Math.max(max, sample.height);
    }
    const fraction = land / count;
    expect(fraction).toBeGreaterThan(0.2);
    expect(fraction).toBeLessThan(0.7);
    expect(max - min).toBeGreaterThan(500);
  });
});

describe("presets", () => {
  it("offers three looks whose values stay inside the registry", () => {
    expect(PLANET_PRESETS.map((preset) => preset.id)).toEqual([
      "earthlike",
      "highlands",
      "archipelago",
    ]);
    for (const preset of PLANET_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      for (const meta of PLANET_PARAM_REGISTRY) {
        if (meta.key === "seed") continue;
        const value = preset.values[meta.key];
        expect(value).toBeGreaterThanOrEqual(meta.min);
        expect(value).toBeLessThanOrEqual(meta.max);
      }
    }
  });

  it("keeps the seed and matches earthlike at the defaults", () => {
    const current = { ...defaultPlanetParams(), seed: 42, mountainStrength: 1 };
    const earth = PLANET_PRESETS[0];
    const highlands = PLANET_PRESETS[1];
    const islands = PLANET_PRESETS[2];
    if (!earth || !highlands || !islands) throw new Error("missing preset");
    const applied = applyPlanetPreset(current, earth);
    expect(applied.seed).toBe(42);
    expect(matchingPlanetPreset(applied)?.id).toBe("earthlike");
    expect(matchingPlanetPreset(defaultPlanetParams())?.id).toBe("earthlike");
    const rugged = applyPlanetPreset(current, highlands);
    const scattered = applyPlanetPreset(current, islands);
    expect(heights(rugged)).not.toEqual(heights(applied));
    expect(heights(scattered)).not.toEqual(heights(rugged));
    expect(matchingPlanetPreset(rugged)?.id).toBe("highlands");
  });
});
