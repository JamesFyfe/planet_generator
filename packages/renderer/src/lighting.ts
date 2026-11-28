import type { PlanetParams, Vec3 } from "@planet/engine";

/** Slider coefficients are stored in 1e-6 / m so the panel can show whole numbers. */
export const SCATTERING_UNIT = 1e-6;

const DEG = Math.PI / 180;

export function isAtmosphereEnabled(params: PlanetParams): boolean {
  return params.atmosphereDensity > 0 && params.atmosphereThickness > 0;
}

/** Sea-level sphere and the outer scattering shell, both in meters. */
export function atmosphereRadii(params: PlanetParams): { inner: number; outer: number } {
  const inner = Math.max(params.radius + params.seaLevel, 1);
  return { inner, outer: inner + Math.max(params.atmosphereThickness, 0) };
}

/**
 * Cloud deck altitude. It sits inside the atmosphere when there is one,
 * and just above the sea when the shell thickness is zero.
 */
export function cloudShellRadius(params: PlanetParams): number {
  const sea = params.radius + params.seaLevel;
  const lift =
    params.atmosphereThickness > 0
      ? params.atmosphereThickness * 0.42
      : Math.max(params.atmosphereScaleHeight, 100) * 0.8;
  return sea + Math.max(lift, 200);
}

export function scatteringCoefficients(params: PlanetParams): { rayleigh: Vec3; mie: number } {
  const density = Math.max(0, params.atmosphereDensity);
  return {
    rayleigh: {
      x: params.rayleighR * SCATTERING_UNIT * density,
      y: params.rayleighG * SCATTERING_UNIT * density,
      z: params.rayleighB * SCATTERING_UNIT * density,
    },
    mie: Math.max(0, params.mieStrength) * SCATTERING_UNIT * density,
  };
}

/**
 * Path length in units of the vertical column. A spherical shell cannot
 * exceed about sqrt(π R / 2H), which is what keeps sunset from going black.
 */
export function airMass(sunUpCosine: number, radius: number, scaleHeight: number): number {
  const cap = Math.sqrt((Math.PI * Math.max(radius, 1)) / (2 * Math.max(scaleHeight, 1)));
  if (sunUpCosine <= 0) return cap;
  return Math.min(1 / Math.max(sunUpCosine, 1e-3), cap);
}

/** Direct-beam color at a surface observer. White when the atmosphere is off. */
export function directSunTransmittance(
  params: PlanetParams,
  sunUpCosine: number,
): { r: number; g: number; b: number } {
  if (!isAtmosphereEnabled(params)) return { r: 1, g: 1, b: 1 };
  const beta = scatteringCoefficients(params);
  const height = Math.max(params.atmosphereScaleHeight, 1);
  const mass = airMass(sunUpCosine, params.radius, height);
  const mie = beta.mie * height * mass;
  const twilight = sunUpCosine < 0 ? Math.max(0, 1 + sunUpCosine / 0.2) : 1;
  return {
    r: Math.exp(-(beta.rayleigh.x * height * mass + mie)) * twilight,
    g: Math.exp(-(beta.rayleigh.y * height * mass + mie)) * twilight,
    b: Math.exp(-(beta.rayleigh.z * height * mass + mie)) * twilight,
  };
}

export function rotationAxis(tiltDegrees: number): Vec3 {
  const tilt = tiltDegrees * DEG;
  return { x: Math.sin(tilt), y: Math.cos(tilt), z: 0 };
}

/** Radians of planet spin in `[0, 2π)`. Time is an argument; nothing reads the clock. */
export function spinAngle(rotationPeriodHours: number, timeSeconds: number): number {
  const period = rotationPeriodHours * 3600;
  if (!(period > 0) || !Number.isFinite(timeSeconds)) return 0;
  const turns = timeSeconds / period;
  return (turns - Math.floor(turns)) * Math.PI * 2;
}

function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const along = v.x * axis.x + v.y * axis.y + v.z * axis.z;
  const cx = axis.y * v.z - axis.z * v.y;
  const cy = axis.z * v.x - axis.x * v.z;
  const cz = axis.x * v.y - axis.y * v.x;
  return {
    x: v.x * cos + cx * sin + axis.x * along * (1 - cos),
    y: v.y * cos + cy * sin + axis.y * along * (1 - cos),
    z: v.z * cos + cz * sin + axis.z * along * (1 - cos),
  };
}

/**
 * Unit vector from the planet center toward the sun, in planet space.
 * The mesh stays fixed and the sun travels, which is the same rotation.
 * Tilt 0 keeps the sun in the XZ plane. Angle 0 puts it on +X.
 */
export function sunDirection(
  tiltDegrees: number,
  rotationPeriodHours: number,
  timeSeconds: number,
): Vec3 {
  const tilt = tiltDegrees * DEG;
  const axis = rotationAxis(tiltDegrees);
  const reference = { x: Math.cos(tilt), y: -Math.sin(tilt), z: 0 };
  return rotateAroundAxis(reference, axis, spinAngle(rotationPeriodHours, timeSeconds));
}

export function sunUpCosine(cameraWorld: Vec3, sun: Vec3): number {
  const radial = Math.hypot(cameraWorld.x, cameraWorld.y, cameraWorld.z);
  if (radial < 1e-6) return 1;
  return (cameraWorld.x * sun.x + cameraWorld.y * sun.y + cameraWorld.z * sun.z) / radial;
}

export function cameraInsideAtmosphere(cameraWorld: Vec3, params: PlanetParams): boolean {
  if (!isAtmosphereEnabled(params)) return false;
  const radial = Math.hypot(cameraWorld.x, cameraWorld.y, cameraWorld.z);
  return radial < atmosphereRadii(params).outer;
}
