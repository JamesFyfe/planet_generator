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

/** Right-drag increases theta. Down-drag decreases phi. The surface follows the pointer. */
export function applyOrbitDrag(angles: OrbitAngles, dx: number, dy: number): void {
  angles.theta += dx * ORBIT_POINTER_SPEED;
  const phi = angles.phi - dy * ORBIT_POINTER_SPEED;
  angles.phi = Math.min(Math.PI - ORBIT_POLE_LIMIT, Math.max(ORBIT_POLE_LIMIT, phi));
}
