import { defaultPlanetParams } from "@planet/engine";
import { describe, expect, it } from "vitest";
import {
  airMass,
  cameraInsideAtmosphere,
  directSunTransmittance,
  isAtmosphereEnabled,
  spinAngle,
  sunDirection,
} from "./lighting";

function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

describe("sun direction", () => {
  it("is a pure function of tilt, period, and time", () => {
    const first = sunDirection(23.4, 24, 12_000);
    const second = sunDirection(23.4, 24, 12_000);
    expect(second).toEqual(first);
    const wrapped = sunDirection(23.4, 24, 12_000 + 86_400);
    expect(wrapped.x).toBeCloseTo(first.x, 8);
    expect(wrapped.y).toBeCloseTo(first.y, 8);
    expect(wrapped.z).toBeCloseTo(first.z, 8);
  });

  it("starts on +X and stays in the equatorial plane when tilt is zero", () => {
    const noon = sunDirection(0, 24, 0);
    expect(noon.x).toBeCloseTo(1, 6);
    expect(noon.y).toBeCloseTo(0, 6);
    expect(noon.z).toBeCloseTo(0, 6);
    const later = sunDirection(0, 24, 6 * 3600);
    expect(later.y).toBeCloseTo(0, 6);
    expect(dot(later, later)).toBeCloseTo(1, 6);
  });

  it("keeps the sun perpendicular to the tilted axis", () => {
    const tilt = 23.4;
    const axis = {
      x: Math.sin((tilt * Math.PI) / 180),
      y: Math.cos((tilt * Math.PI) / 180),
      z: 0,
    };
    for (const hours of [0, 3, 9, 15]) {
      const sun = sunDirection(tilt, 24, hours * 3600);
      expect(Math.abs(dot(sun, axis))).toBeLessThan(1e-6);
    }
  });

  it("wraps the spin angle into one turn", () => {
    expect(spinAngle(24, 0)).toBe(0);
    expect(spinAngle(24, 24 * 3600)).toBe(0);
    expect(spinAngle(24, 12 * 3600)).toBeCloseTo(Math.PI, 6);
    expect(spinAngle(0, 10)).toBe(0);
  });
});

describe("atmosphere lighting", () => {
  it("switches off at zero density and zero thickness", () => {
    expect(isAtmosphereEnabled(defaultPlanetParams())).toBe(true);
    expect(isAtmosphereEnabled({ ...defaultPlanetParams(), atmosphereDensity: 0 })).toBe(false);
    expect(isAtmosphereEnabled({ ...defaultPlanetParams(), atmosphereThickness: 0 })).toBe(false);
  });

  it("leaves the direct sun white for an airless body", () => {
    const airless = { ...defaultPlanetParams(), atmosphereDensity: 0 };
    expect(directSunTransmittance(airless, 0.05)).toEqual({ r: 1, g: 1, b: 1 });
  });

  it("reddens the sun toward the horizon and keeps noon brighter in the blue", () => {
    const params = defaultPlanetParams();
    const noon = directSunTransmittance(params, 1);
    const sunset = directSunTransmittance(params, 0.05);
    expect(noon.b).toBeGreaterThan(0.4);
    expect(noon.b).toBeLessThan(noon.r);
    expect(sunset.r).toBeGreaterThan(sunset.b * 3);
    expect(sunset.b).toBeLessThan(noon.b);
    expect(airMass(0.05, params.radius, params.atmosphereScaleHeight)).toBeLessThan(12);
  });

  it("treats orbit as outside the shell and the ground as inside", () => {
    const params = defaultPlanetParams();
    const orbit = { x: params.radius * 3, y: 0, z: 0 };
    const ground = { x: params.radius + 100, y: 0, z: 0 };
    expect(cameraInsideAtmosphere(orbit, params)).toBe(false);
    expect(cameraInsideAtmosphere(ground, params)).toBe(true);
    expect(cameraInsideAtmosphere(ground, { ...params, atmosphereDensity: 0 })).toBe(false);
  });
});
