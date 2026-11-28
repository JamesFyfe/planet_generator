import { describe, expect, it } from "vitest";
import { climateBake, sampleClimate } from "./bake";
import { classifyBiome } from "./classify";
import { cellAtDirection, climateCellCount, climateCellDirection, climateNeighbors } from "./grid";
import { BOUNDARY_CONVERGENT, BOUNDARY_DIVERGENT, materialIndexFromPlate } from "./material";
import { advectMoisture } from "./moisture";
import { latitudeRadians, seaLevelTemperatureC, surfaceTemperatureC } from "./temperature";
import { prevailingWind } from "./wind";
import {
  BIOME_MOISTURE_MAX,
  BIOME_MOISTURE_MIN,
  BIOME_RULES,
  BIOME_TEMPERATURE_MAX,
  BIOME_TEMPERATURE_MIN,
  BIOMES,
  ICE_CAP_TEMPERATURE_MAX,
  biomeIndex,
  climateBinContains,
} from "../data/biomes";
import {
  MATERIAL_BASALT,
  MATERIAL_GRANITE,
  MATERIAL_SEDIMENTARY,
  MATERIAL_VOLCANIC,
} from "../data/materials";
import { createPlanet, defaultPlanetParams, type PlanetParams } from "../index";

function withParams(patch: Partial<PlanetParams>): PlanetParams {
  return { ...defaultPlanetParams(), ...patch };
}

describe("temperature", () => {
  it("decreases with altitude and toward the poles", () => {
    const params = defaultPlanetParams();
    const equator = { x: 1, y: 0, z: 0 };
    const pole = { x: 0, y: 1, z: 0 };
    const seaEquator = seaLevelTemperatureC(params, equator);
    const seaPole = seaLevelTemperatureC(params, pole);
    expect(seaPole).toBeLessThan(seaEquator);
    expect(seaPole).toBeLessThan(ICE_CAP_TEMPERATURE_MAX);

    const low = surfaceTemperatureC(seaEquator, 0);
    const mid = surfaceTemperatureC(seaEquator, 1_000);
    const high = surfaceTemperatureC(seaEquator, 3_000);
    expect(low).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(high);
    expect(low - mid).toBeCloseTo(6.5, 5);

    const latitudes = [0, 20, 40, 60, 80];
    const alongMeridian = latitudes.map((degrees) => {
      const radians = (degrees * Math.PI) / 180;
      return seaLevelTemperatureC(params, {
        x: Math.cos(radians),
        y: Math.sin(radians),
        z: 0,
      });
    });
    for (let index = 0; index < alongMeridian.length - 1; index++) {
      expect(alongMeridian[index + 1]).toBeLessThan(alongMeridian[index] ?? 0);
    }
  });

  it("warms when the star is closer or the atmosphere is thicker, and tilt warms the pole", () => {
    const equator = { x: 1, y: 0, z: 0 };
    const pole = { x: 0, y: 1, z: 0 };
    const base = defaultPlanetParams();
    expect(seaLevelTemperatureC(withParams({ starDistance: 0.6 }), equator)).toBeGreaterThan(
      seaLevelTemperatureC(base, equator),
    );
    expect(seaLevelTemperatureC(withParams({ starDistance: 1.8 }), equator)).toBeLessThan(
      seaLevelTemperatureC(base, equator),
    );
    expect(seaLevelTemperatureC(withParams({ atmosphereDensity: 0 }), equator)).toBeLessThan(
      seaLevelTemperatureC(base, equator),
    );
    expect(seaLevelTemperatureC(withParams({ atmosphereDensity: 3 }), equator)).toBeGreaterThan(
      seaLevelTemperatureC(base, equator),
    );
    const upright = seaLevelTemperatureC(withParams({ axialTilt: 0 }), pole);
    const tilted = seaLevelTemperatureC(withParams({ axialTilt: 45 }), pole);
    expect(tilted).toBeGreaterThan(upright);
  });

  it("is a pure function of direction", () => {
    const params = defaultPlanetParams();
    const direction = { x: 0.2, y: -0.4, z: 0.5 };
    expect(seaLevelTemperatureC(params, direction)).toBe(seaLevelTemperatureC(params, direction));
    expect(latitudeRadians({ x: 0, y: 2, z: 0 })).toBeCloseTo(Math.PI / 2, 8);
  });
});

describe("wind", () => {
  it("flips the east-west sense between the trades and the westerlies", () => {
    const trades = prevailingWind({ x: 1, y: 0.1, z: 0 });
    const westerlies = prevailingWind({ x: 1, y: 0.8, z: 0 });
    expect(trades.z).not.toBe(0);
    expect(Math.sign(trades.z)).not.toBe(Math.sign(westerlies.z));
    const again = prevailingWind({ x: 1, y: 0.1, z: 0 });
    expect(again).toEqual(trades);
  });
});

describe("moisture advection", () => {
  it("is lower in the rain shadow than on the windward side", () => {
    const cells = [
      { ocean: true, height: -200, upwind: -1, evaporation: 1 },
      { ocean: false, height: 40, upwind: 0, evaporation: 0 },
      { ocean: false, height: 2_200, upwind: 1, evaporation: 0 },
      { ocean: false, height: 180, upwind: 2, evaporation: 0 },
    ];
    const first = advectMoisture(cells, 1, 6);
    const second = advectMoisture(cells, 1, 6);
    expect(Array.from(second.moisture)).toEqual(Array.from(first.moisture));
    const windward = first.moisture[1] ?? 0;
    const shadow = first.moisture[3] ?? 0;
    expect(windward).toBeGreaterThan(0.4);
    expect(shadow).toBeLessThan(windward * 0.5);
    expect(first.rainfall[2] ?? 0).toBeGreaterThan(first.rainfall[3] ?? 0);
  });

  it("leaves land dry when the wind does not blow", () => {
    const cells = [
      { ocean: true, height: -100, upwind: -1, evaporation: 1 },
      { ocean: false, height: 20, upwind: 0, evaporation: 0 },
    ];
    const still = advectMoisture(cells, 0, 4);
    expect(still.moisture[1]).toBe(0);
  });
});

describe("biome table", () => {
  it("covers the full temperature and moisture range with no gaps or overlaps", () => {
    const temperatureSteps = 61;
    const moistureSteps = 41;
    for (let tIndex = 0; tIndex < temperatureSteps; tIndex++) {
      const temperature =
        BIOME_TEMPERATURE_MIN +
        ((BIOME_TEMPERATURE_MAX - BIOME_TEMPERATURE_MIN) * tIndex) / (temperatureSteps - 1);
      for (let mIndex = 0; mIndex < moistureSteps; mIndex++) {
        const moisture =
          BIOME_MOISTURE_MIN +
          ((BIOME_MOISTURE_MAX - BIOME_MOISTURE_MIN) * mIndex) / (moistureSteps - 1);
        const matches = BIOME_RULES.filter(
          (rule) => rule.priority === 0 && climateBinContains(rule, temperature, moisture),
        );
        expect(matches, `${temperature}°C ${moisture}`).toHaveLength(1);
        const choice = classifyBiome({
          temperature,
          moisture,
          seaRelativeHeight: 500,
          slope: 0.05,
          materialId: MATERIAL_GRANITE,
          shoreWidth: 200,
          sharpness: 2,
        });
        expect(choice.biomeId).toBe(biomeIndex(matches[0]?.id ?? "desert"));
        expect(choice.weight).toBeGreaterThan(0);
        expect(choice.weight).toBeLessThanOrEqual(1);
      }
    }
  });

  it("assigns ice and tundra from temperature", () => {
    const cold = classifyBiome({
      temperature: ICE_CAP_TEMPERATURE_MAX - 0.5,
      moisture: 0.9,
      seaRelativeHeight: 400,
      slope: 0.05,
      materialId: MATERIAL_GRANITE,
      shoreWidth: 200,
      sharpness: 4,
    });
    const permafrost = classifyBiome({
      temperature: ICE_CAP_TEMPERATURE_MAX + 0.5,
      moisture: 0.2,
      seaRelativeHeight: 400,
      slope: 0.05,
      materialId: MATERIAL_GRANITE,
      shoreWidth: 200,
      sharpness: 4,
    });
    expect(cold.biomeId).toBe(biomeIndex("ice_cap"));
    expect(permafrost.biomeId).toBe(biomeIndex("tundra"));
    const seaIce = classifyBiome({
      temperature: -20,
      moisture: 1,
      seaRelativeHeight: -30,
      slope: 0,
      materialId: MATERIAL_BASALT,
      shoreWidth: 200,
      sharpness: 2,
    });
    expect(seaIce.biomeId).toBe(biomeIndex("ice_cap"));
  });
});

describe("material", () => {
  it("follows crust and plate boundaries", () => {
    expect(
      materialIndexFromPlate({
        crust: 0,
        boundary: 0,
        volcanic: 0,
        slope: 0.1,
        seaRelativeHeight: -200,
      }),
    ).toBe(MATERIAL_BASALT);
    expect(
      materialIndexFromPlate({
        crust: 1,
        boundary: 0,
        volcanic: 0,
        slope: 0.1,
        seaRelativeHeight: 200,
      }),
    ).toBe(MATERIAL_SEDIMENTARY);
    expect(
      materialIndexFromPlate({
        crust: 1,
        boundary: 0,
        volcanic: 0,
        slope: 0.6,
        seaRelativeHeight: 2_000,
      }),
    ).toBe(MATERIAL_GRANITE);
    expect(
      materialIndexFromPlate({
        crust: 1,
        boundary: BOUNDARY_DIVERGENT,
        volcanic: 0.2,
        slope: 0.2,
        seaRelativeHeight: 500,
      }),
    ).toBe(MATERIAL_VOLCANIC);
    expect(
      materialIndexFromPlate({
        crust: 0,
        boundary: BOUNDARY_CONVERGENT,
        volcanic: 0.5,
        slope: 0.4,
        seaRelativeHeight: 300,
      }),
    ).toBe(MATERIAL_VOLCANIC);
  });
});

describe("climate bake", () => {
  it("is deterministic and does not depend on call order", () => {
    const params = defaultPlanetParams();
    const direction = { x: 0.2, y: -0.4, z: 0.5 };
    const first = sampleClimate(params, direction, 120, 0.1);
    sampleClimate(withParams({ seed: 9 }), { x: 0, y: 1, z: 0 }, 0, 0);
    const second = sampleClimate(params, direction, 120, 0.1);
    expect(second).toEqual(first);
    const bake = climateBake(params);
    expect(Array.from(climateBake(params).moisture)).toEqual(Array.from(bake.moisture));
    expect(bake.moisture.length).toBe(climateCellCount());
  });

  it("keeps ocean distance at zero on the ocean and positive inland", () => {
    const bake = climateBake(defaultPlanetParams());
    let ocean = 0;
    let inland = 0;
    for (let index = 0; index < bake.seaRelativeHeight.length; index++) {
      const height = bake.seaRelativeHeight[index] ?? 0;
      if (height < 0) {
        ocean += 1;
        expect(bake.oceanDistance[index]).toBe(0);
        expect(bake.continentality[index]).toBe(0);
      } else if ((bake.continentality[index] ?? 0) > 0.45) {
        inland += 1;
        expect(bake.oceanDistance[index] ?? 0).toBeGreaterThan(0);
        expect(bake.moisture[index] ?? 1).toBeLessThan(0.75);
      }
    }
    expect(ocean).toBeGreaterThan(100);
    expect(inland).toBeGreaterThan(10);
  });

  it("puts ice on cold land, desert inland, and forest where moisture remains", () => {
    const params = defaultPlanetParams();
    const bake = climateBake(params);
    const counts = new Map<string, number>();
    for (let index = 0; index < bake.seaRelativeHeight.length; index++) {
      const height = bake.seaRelativeHeight[index] ?? 0;
      if (height < 0) continue;
      const point = sampleClimate(
        params,
        climateCellDirection(index),
        height,
        bake.slope[index] ?? 0,
      );
      const id = BIOMES.find((biome) => biome.index === point.biomeId)?.id ?? "unknown";
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const ice = (counts.get("ice_cap") ?? 0) + (counts.get("tundra") ?? 0);
    const dry = (counts.get("desert") ?? 0) + (counts.get("grassland") ?? 0);
    const lush =
      (counts.get("tropical_rainforest") ?? 0) +
      (counts.get("temperate_forest") ?? 0) +
      (counts.get("boreal_forest") ?? 0) +
      (counts.get("wetland") ?? 0);
    expect(ice, JSON.stringify([...counts.entries()])).toBeGreaterThan(20);
    expect(dry, JSON.stringify([...counts.entries()])).toBeGreaterThan(20);
    expect(lush, JSON.stringify([...counts.entries()])).toBeGreaterThan(20);
  });

  it("crosses cube-face edges without a cell pointing at itself", () => {
    const neighbors = climateNeighbors();
    const resolution = 32;
    let crossed = 0;
    for (let index = 0; index < climateCellCount(); index++) {
      for (let slot = 0; slot < 4; slot++) {
        const neighbor = neighbors[index * 4 + slot] ?? -1;
        expect(neighbor).toBeGreaterThanOrEqual(0);
        expect(neighbor).not.toBe(index);
        if (
          Math.floor(neighbor / (resolution * resolution)) !==
          Math.floor(index / (resolution * resolution))
        ) {
          crossed += 1;
        }
      }
    }
    expect(crossed).toBeGreaterThan(0);
    const equator = cellAtDirection({ x: 1, y: 0, z: 0 });
    expect(cellAtDirection({ x: 2, y: 0, z: 0 })).toBe(equator);
  });
});

describe("sample climate fields", () => {
  it("reports finite climate on the planet sample and a colder high sample", () => {
    const planet = createPlanet(defaultPlanetParams());
    const low = planet.sample({ x: 1, y: 0, z: 0 });
    expect(Number.isFinite(low.temperature)).toBe(true);
    expect(Number.isFinite(low.moisture)).toBe(true);
    expect(low.biomeId).toBeGreaterThanOrEqual(0);
    expect(low.biomeWeight).toBeGreaterThan(0);
    const sea = sampleClimate(planet.params, { x: 1, y: 0, z: 0 }, 0, 0.05);
    const raised = sampleClimate(planet.params, { x: 1, y: 0, z: 0 }, 2_500, 0.05);
    expect(raised.temperature).toBeCloseTo(sea.temperature - 2_500 * 0.0065, 5);
  });
});
