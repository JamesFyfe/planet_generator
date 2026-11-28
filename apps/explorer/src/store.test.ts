import { PLANET_PARAMS_VERSION, defaultPlanetParams } from "@planet/engine";
import { beforeEach, describe, expect, it } from "vitest";
import { usePlanetStore } from "./store";

describe("planet store", () => {
  beforeEach(() => {
    usePlanetStore.getState().resetParams();
  });

  it("starts from the registry defaults", () => {
    expect(usePlanetStore.getState().params).toEqual(defaultPlanetParams());
  });

  it("writes a panel value into the store and clamps it", () => {
    usePlanetStore.getState().setParam("continentScale", 2.5);
    expect(usePlanetStore.getState().params.continentScale).toBe(2.5);
    expect(usePlanetStore.getState().params.version).toBe(PLANET_PARAMS_VERSION);

    usePlanetStore.getState().setParam("radius", 1);
    expect(usePlanetStore.getState().params.radius).toBe(5_000);

    usePlanetStore.getState().setParam("seed", 42);
    expect(usePlanetStore.getState().params.seed).toBe(42);

    usePlanetStore.getState().setParam("amplitude", 80_000);
    expect(usePlanetStore.getState().params.amplitude).toBe(20_000);
    usePlanetStore.getState().setParam("seaLevel", 400);
    expect(usePlanetStore.getState().params.seaLevel).toBe(400);
    usePlanetStore.getState().setParam("mountainOctaves", 0);
    expect(usePlanetStore.getState().params.mountainOctaves).toBe(1);
  });

  it("applies a preset without changing the seed", () => {
    usePlanetStore.getState().setParam("seed", 42);
    usePlanetStore.getState().applyPreset("highlands");
    const params = usePlanetStore.getState().params;
    expect(params.seed).toBe(42);
    expect(params.mountainStrength).toBeGreaterThan(defaultPlanetParams().mountainStrength);
    expect(params.seaLevel).toBeLessThan(0);
  });

  it("switches the debug channel without resetting planet params", () => {
    usePlanetStore.getState().setParam("seed", 7);
    usePlanetStore.getState().setDebugChannel("slope");
    expect(usePlanetStore.getState().debugChannel).toBe("slope");
    usePlanetStore.getState().resetParams();
    expect(usePlanetStore.getState().params).toEqual(defaultPlanetParams());
    expect(usePlanetStore.getState().debugChannel).toBe("slope");
  });
});
