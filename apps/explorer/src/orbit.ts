export const ORBIT_POINTER_SPEED = 0.005;

/** Stay off the exact pole, where the screen-up projection vanishes. */
export const ORBIT_POLE_LIMIT = 0.05;

export interface OrbitAngles {
  theta: number;
  phi: number;
}

export function spherical(distance: number, theta: number, phi: number) {
  const sinPhi = Math.sin(phi);
  return {
    x: distance * sinPhi * Math.cos(theta),
    y: distance * Math.cos(phi),
    z: distance * sinPhi * Math.sin(theta),
  };
}

/**
 * Screen-up for a camera looking from `dir` back at the planet.
 * This is world +Y projected onto the plane perpendicular to the view.
 * The projection gets shorter near a pole and is renormalized, so it turns
 * smoothly as the orbit passes overhead. Replacing it with another world
 * axis once it is short rolls the view by about a right angle in one frame.
 */
export function viewUp(dirX: number, dirY: number, dirZ: number) {
  const x = -dirX * dirY;
  const y = 1 - dirY * dirY;
  const z = -dirZ * dirY;
  const len = Math.hypot(x, y, z);
  if (len < 1e-8) return { x: 1, y: 0, z: 0 };
  return { x: x / len, y: y / len, z: z / len };
}

export interface OrbitVec {
  x: number;
  y: number;
  z: number;
}

function dot(a: OrbitVec, b: OrbitVec): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function scale(v: OrbitVec, factor: number): OrbitVec {
  return { x: v.x * factor, y: v.y * factor, z: v.z * factor };
}

function add(a: OrbitVec, b: OrbitVec): OrbitVec {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: OrbitVec, b: OrbitVec): OrbitVec {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function normalize(v: OrbitVec): OrbitVec {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-8) return { x: 0, y: 1, z: 0 };
  return scale(v, 1 / len);
}

/**
 * 0 looks straight down at the planet. 1 looks along the horizon so the
 * sky, the limb, and a sunset are actually in frame. The blend runs while
 * the camera descends through the outer atmosphere.
 */
export function surfacePitch(altitude: number, radius: number): number {
  const start = radius * 0.4;
  const end = Math.max(800, radius * 0.02);
  if (!(altitude < start)) return 0;
  if (altitude <= end) return 1;
  const t = (start - altitude) / (start - end);
  return t * t * (3 - 2 * t);
}

/**
 * `glance` is a world direction to face once the view has pitched up.
 * Null keeps the heading that was screen-up while looking at the planet.
 */
export function pitchedLook(
  radial: OrbitVec,
  screenUp: OrbitVec,
  pitch: number,
  glance: OrbitVec | null,
): { look: OrbitVec; up: OrbitVec } {
  const clamped = Math.min(1, Math.max(0, pitch));
  const nadir = scale(radial, -1);
  if (clamped <= 0) return { look: nadir, up: screenUp };
  const hint = glance ?? screenUp;
  const tangent = normalize(sub(hint, scale(radial, dot(hint, radial))));
  const look = normalize(add(scale(nadir, 1 - clamped), scale(tangent, clamped)));
  const sky = sub(radial, scale(look, dot(radial, look)));
  const skyLen = Math.hypot(sky.x, sky.y, sky.z);
  const skyUp = skyLen < 1e-6 ? screenUp : scale(sky, 1 / skyLen);
  const up = normalize(add(scale(screenUp, 1 - clamped), scale(skyUp, clamped)));
  return { look, up };
}

/** Right-drag increases theta. Down-drag decreases phi. The surface follows the pointer. */
export function applyOrbitDrag(angles: OrbitAngles, dx: number, dy: number): void {
  angles.theta += dx * ORBIT_POINTER_SPEED;
  const phi = angles.phi - dy * ORBIT_POINTER_SPEED;
  angles.phi = Math.min(Math.PI - ORBIT_POLE_LIMIT, Math.max(ORBIT_POLE_LIMIT, phi));
}
