import type { Vec3 } from "../noise/domainWarp";
import type { PlanetParams } from "../params";
import { clamp } from "../vec3";

/**
 * Environmental lapse rate, °C per meter. A named climate constant, not a
 * stand-in for relief or radius.
 */
export const LAPSE_RATE_C_PER_M = 0.0065;

/** Sea-level equator at insolation 1, default atmosphere, before latitude loss. */
const EQUATOR_SEA_LEVEL_C = 29;

/**
 * Equator-to-pole drop at zero tilt. Combined with the latitude factor this
 * puts default poles under the ice bin and the equator in the tropical bins.
 */
const POLE_DROP_C = 64;

/** °C gained when the fourth-root insolation factor moves by 1. */
const STAR_SENSITIVITY_C = 56;

/** Greenhouse span. Zero at atmosphere density 1; airless is this much colder. */
const GREENHOUSE_REFERENCE_C = 24;

export function latitudeRadians(direction: Vec3): number {
  const magnitude = Math.hypot(direction.x, direction.y, direction.z);
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new Error("direction must be a finite non-zero vector");
  }
  return Math.asin(clamp(direction.y / magnitude, -1, 1));
}

/**
 * Mean annual insolation by latitude, roughly 1 at the equator and 0 at a
 * pole when tilt is 0. Tilt moves energy poleward so the gradient shrinks;
 * it does not brighten the whole planet.
 */
export function latitudeInsolation(latitude: number, tiltRadians: number): number {
  const daylight = Math.cos(Math.abs(latitude));
  const spread = Math.sin(clamp(tiltRadians, 0, Math.PI / 2));
  const polar = spread * spread;
  return daylight * (1 - 0.25 * polar) + (1 - daylight) * polar * 0.55;
}

export function greenhouseOffsetC(atmosphereDensity: number): number {
  const density = Math.max(atmosphereDensity, 0);
  return GREENHOUSE_REFERENCE_C * (Math.log2(1 + density) - 1);
}

function starInsolation(starDistance: number): number {
  const distance = Math.max(starDistance, 1e-3);
  return 1 / (distance * distance);
}

/**
 * Temperature at sea level for this latitude and the climate sliders.
 * Altitude is applied separately so a chunk vertex can reuse the bake.
 */
export function seaLevelTemperatureC(params: PlanetParams, direction: Vec3): number {
  // Mean annual insolation depends on obliquity, so a negative tilt matches its absolute value.
  const tilt = (Math.abs(params.axialTilt) * Math.PI) / 180;
  const latitude = latitudeInsolation(latitudeRadians(direction), tilt);
  const solar = Math.pow(Math.max(starInsolation(params.starDistance), 0), 0.25);
  return (
    EQUATOR_SEA_LEVEL_C +
    POLE_DROP_C * (latitude - 1) +
    (solar - 1) * STAR_SENSITIVITY_C +
    greenhouseOffsetC(params.atmosphereDensity) +
    params.temperatureOffset
  );
}

/** Mean annual surface temperature. Below sea level the surface is the water, so lapse stops there. */
export function surfaceTemperatureC(
  seaLevelTemperature: number,
  seaRelativeHeight: number,
): number {
  const altitude = Math.max(seaRelativeHeight, 0);
  return seaLevelTemperature - LAPSE_RATE_C_PER_M * altitude;
}
