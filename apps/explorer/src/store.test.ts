import { defaultPlanetParams } from "@planet/engine";
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
    usePlanetStore.getState().setParam("noiseScale", 2.5);
    expect(usePlanetStore.getState().params.noiseScale).toBe(2.5);
    expect(usePlanetStore.getState().params.version).toBe(1);

    usePlanetStore.getState().setParam("radius", 1);
    expect(usePlanetStore.getState().params.radius).toBe(5_000);

    usePlanetStore.getState().setParam("seed", 42);
    expect(usePlanetStore.getState().params.seed).toBe(42);
  });
});
