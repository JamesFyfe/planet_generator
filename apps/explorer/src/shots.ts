import type { PlanetSample, Vec3 } from "@planet/engine";
import { sunDirection } from "@planet/renderer";
import { spherical } from "./orbit";

export interface ShotPose {
  theta: number;
  phi: number;
  distance: number;
  glance: Vec3;
  pitch: number;
  timeSeconds: number;
}

const POLE = 0.05;

function dot(a: Vec3, b: Vec3): Vec3["x"] {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function orbitAngles(dir: Vec3): { theta: number; phi: number } {
  const n = normalize(dir);
  const phi = Math.min(Math.PI - POLE, Math.max(POLE, Math.acos(Math.min(1, Math.max(-1, n.y)))));
  return { theta: Math.atan2(n.z, n.x), phi };
}

function tangentToward(radial: Vec3, hint: Vec3): Vec3 {
  return normalize({
    x: hint.x - radial.x * dot(radial, hint),
    y: hint.y - radial.y * dot(radial, hint),
    z: hint.z - radial.z * dot(radial, hint),
  });
}

/** Land on the terminator, looking along the sun so the horizon glow is in frame. */
export function findSunsetPose(
  sample: (dir: Vec3) => PlanetSample,
  radius: number,
  tilt: number,
  periodHours: number,
): ShotPose {
  const timeSeconds = periodHours * 3600 * 0.18;
  const sun = sunDirection(tilt, periodHours, timeSeconds);
  let best: { dir: Vec3; score: number; height: number } | null = null;
  for (let j = 2; j < 36; j++) {
    const phi = (j / 36) * Math.PI;
    for (let i = 0; i < 64; i++) {
      const theta = (i / 64) * Math.PI * 2;
      const dir = spherical(1, theta, phi);
      const hit = sample(dir);
      if (hit.seaRelativeHeight < 60 || hit.seaRelativeHeight > 800) continue;
      // A few degrees above the horizon. Exactly on it leaves the ground
      // unlit and hides the reddened band behind the terrain silhouette.
      const score = Math.abs(dot(dir, sun) - 0.14);
      if (!best || score < best.score) best = { dir, score, height: hit.height };
    }
  }
  const dir = best?.dir ?? { x: 1, y: 0, z: 0 };
  const angles = orbitAngles(dir);
  return {
    ...angles,
    distance: radius + (best?.height ?? 0) + 70,
    glance: tangentToward(dir, sun),
    pitch: 1,
    timeSeconds,
  };
}

/**
 * Shallow water with land a short walk away, in daylight, pitched so the
 * near water and the shore share the frame. The camera stays above sea
 * level even when the sample itself is wet.
 */
export function findShorePose(
  sample: (dir: Vec3) => PlanetSample,
  radius: number,
  timeSeconds: number,
  tiltDegrees = 23.4,
  periodHours = 24,
): ShotPose {
  let best: {
    dir: Vec3;
    score: number;
    height: number;
    sea: number;
    glance: Vec3;
  } | null = null;
  const rows = 48;
  const cols = 96;
  const step = 0.02;
  for (let j = 2; j < rows - 1; j++) {
    const phi = (j / rows) * Math.PI;
    if (phi < 0.55 || phi > Math.PI - 0.55) continue;
    for (let i = 0; i < cols; i++) {
      const theta = (i / cols) * Math.PI * 2;
      const dir = spherical(1, theta, phi);
      const here = sample(dir);
      if (here.seaRelativeHeight < -70 || here.seaRelativeHeight > -8) continue;
      const east = sample(spherical(1, theta + step, phi));
      const north = sample(spherical(1, theta, Math.min(phi + step, Math.PI - POLE)));
      const eastDry = east.seaRelativeHeight > 4;
      const northDry = north.seaRelativeHeight > 4;
      if (!eastDry && !northDry) continue;
      const glanceDir = eastDry
        ? spherical(1, theta + step, phi)
        : spherical(1, theta, Math.min(phi + step, Math.PI - POLE));
      const dryHeight = eastDry ? east.seaRelativeHeight : north.seaRelativeHeight;
      const score = Math.abs(here.seaRelativeHeight + 6) - Math.min(dryHeight, 40);
      if (!best || score < best.score) {
        best = {
          dir,
          score,
          height: here.height,
          sea: here.height - here.seaRelativeHeight,
          glance: glanceDir,
        };
      }
    }
  }
  const dir = best?.dir ?? { x: 0, y: 0, z: 1 };
  const sea = best?.sea ?? 0;
  const surface = Math.max(best?.height ?? 0, sea);
  let daytime = timeSeconds;
  let bestElev = -2;
  const period = periodHours * 3600;
  for (let stepIndex = 0; stepIndex < 24; stepIndex++) {
    const time = (stepIndex / 24) * period;
    const sun = sunDirection(tiltDegrees, periodHours, time);
    const elev = dir.x * sun.x + dir.y * sun.y + dir.z * sun.z;
    if (elev > bestElev) {
      bestElev = elev;
      daytime = time;
    }
  }
  const angles = orbitAngles(dir);
  return {
    ...angles,
    distance: radius + surface + 220,
    glance: tangentToward(dir, best?.glance ?? { x: dir.z, y: 0, z: -dir.x }),
    pitch: 0.28,
    timeSeconds: daytime,
  };
}
