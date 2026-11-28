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
    expect(groups.Noise?.octaves).toEqual({
      value: 5,
      min: 1,
      max: 8,
      step: 1,
      label: "Octaves",
    });
    expect(groups.Noise?.amplitude).toEqual({
      value: 3_000,
      min: 0,
      max: 20_000,
      step: 100,
      label: "Amplitude (m)",
    });
    expect(groups.Surface?.seaLevel).toEqual({
      value: 0,
      min: -10_000,
      max: 10_000,
      step: 100,
      label: "Sea level (m)",
    });
    expect(groups.Atmosphere?.atmosphereDensity).toMatchObject({
      value: 1,
      min: 0,
      label: "Density",
    });
    expect(groups.Atmosphere?.rayleighB).toMatchObject({ value: 225, label: "Rayleigh B" });
    expect(groups.Clouds?.cloudCoverage).toMatchObject({ value: 0.48, label: "Coverage" });
    expect(groups.Motion?.axialTilt).toMatchObject({ value: 23.4, label: "Axial tilt (°)" });
    expect(groups.Motion?.rotationPeriod).toMatchObject({ value: 24, label: "Rotation (h)" });
    expect(Object.keys(groups)).toEqual([
      "World",
      "Noise",
      "Surface",
      "Atmosphere",
      "Clouds",
      "Motion",
    ]);
  });
});
