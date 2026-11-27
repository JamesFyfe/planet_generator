import type { Vec3 } from "@planet/engine";
import { Frustum, Matrix4, Sphere, Vector3 } from "three";
import type { PerspectiveCamera } from "three";

const frustum = new Frustum();
const frustumMatrix = new Matrix4();
const sphere = new Sphere();
const center = new Vector3();

export function cameraFrustum(camera: PerspectiveCamera): Frustum {
  camera.updateMatrixWorld();
  frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(frustumMatrix);
  return frustum;
}

export function isSphereInFrustum(
  camera: PerspectiveCamera,
  renderCenter: Vec3,
  radius: number,
): boolean {
  center.set(renderCenter.x, renderCenter.y, renderCenter.z);
  sphere.center.copy(center);
  sphere.radius = radius;
  return cameraFrustum(camera).intersectsSphere(sphere);
}

/**
 * True when the chunk's bounding sphere sits past the planet's limb.
 * The occluder is the smallest radius the surface might have, so a mountain
 * just over the mean horizon is not dropped.
 */
export function isBeyondHorizon(
  cameraWorld: Vec3,
  chunkCenterWorld: Vec3,
  chunkRadius: number,
  occluderRadius: number,
): boolean {
  const camDist = Math.hypot(cameraWorld.x, cameraWorld.y, cameraWorld.z);
  if (!(occluderRadius > 0) || camDist <= occluderRadius) return false;
  const chunkDist = Math.hypot(chunkCenterWorld.x, chunkCenterWorld.y, chunkCenterWorld.z);
  if (chunkDist <= 1e-6) return false;
  const cosTheta =
    (cameraWorld.x * chunkCenterWorld.x +
      cameraWorld.y * chunkCenterWorld.y +
      cameraWorld.z * chunkCenterWorld.z) /
    (camDist * chunkDist);
  const theta = Math.acos(Math.min(1, Math.max(-1, cosTheta)));
  const horizon = Math.acos(Math.min(1, Math.max(-1, occluderRadius / camDist)));
  const angular = Math.asin(Math.min(1, chunkRadius / Math.max(chunkDist, 1e-6)));
  return theta - angular > horizon + 1e-4;
}

/** Shrink the horizon sphere by the relief so tall ground can still peek over it. */
export function horizonOccluder(planetRadius: number, relief: number): number {
  return Math.max(planetRadius * 0.5, planetRadius - Math.max(0, relief));
}
