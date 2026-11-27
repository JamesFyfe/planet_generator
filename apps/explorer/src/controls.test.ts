import { describe, expect, it } from "vitest";
import { controlsFromRegistry } from "./controls";

describe("controlsFromRegistry", () => {
  it("copies registry metadata into grouped slider specs", () => {
    const groups = controlsFromRegistry();
    expect(groups.World?.seed).toEqual({
      value: 1,
      min: 0,
      max: 1_000_000,
      step: 1,
      label: "Seed",
    });
    expect(groups.World?.radius).toEqual({
      value: 50_000,
      min: 5_000,
      max: 500_000,
      step: 1_000,
      label: "Radius (m)",
    });
    expect(groups.Noise?.noiseScale).toEqual({
      value: 1,
      min: 0.1,
      max: 10,
      step: 0.1,
      label: "Noise scale",
    });
    expect(Object.keys(groups)).toEqual(["World", "Noise"]);
  });
});
