import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { applyOrbitDrag, spherical, viewUp } from "./orbit";

function angleDeg(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

function cameraFor(theta: number, phi: number, distance: number) {
  const cameraWorld = spherical(distance, theta, phi);
  const unit = spherical(1, theta, phi);
  const up = viewUp(unit.x, unit.y, unit.z);
  const camera = new PerspectiveCamera(45, 16 / 9, 0.5, 1_000_000);
  camera.up.set(up.x, up.y, up.z);
  camera.position.set(0, 0, 0);
  camera.lookAt(-cameraWorld.x, -cameraWorld.y, -cameraWorld.z);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return { camera, cameraWorld, unit };
}

function project(
  camera: PerspectiveCamera,
  cameraWorld: { x: number; y: number; z: number },
  point: { x: number; y: number; z: number },
) {
  return new Vector3(
    point.x - cameraWorld.x,
    point.y - cameraWorld.y,
    point.z - cameraWorld.z,
  ).project(camera);
}

describe("viewUp", () => {
  it("stays continuous while the view passes over either pole", () => {
    for (const theta of [0.2, 1.3, 2.6]) {
      for (const towardSouth of [false, true]) {
        let phi = towardSouth ? Math.PI - 0.55 : 0.55;
        const step = towardSouth ? 0.01 : -0.01;
        let previous = viewUp(
          spherical(1, theta, phi).x,
          spherical(1, theta, phi).y,
          spherical(1, theta, phi).z,
        );
        for (let i = 0; i < 50; i++) {
          phi += step;
          const dir = spherical(1, theta, phi);
          const up = viewUp(dir.x, dir.y, dir.z);
          expect(angleDeg(previous, up)).toBeLessThan(8);
          expect(Math.abs(dir.x * up.x + dir.y * up.y + dir.z * up.z)).toBeLessThan(1e-9);
          previous = up;
        }
      }
    }
  });
});

describe("applyOrbitDrag", () => {
  it("moves the surface with the pointer, including when looking down on a pole", () => {
    for (const phi of [1.05, 0.22, Math.PI - 0.22]) {
      const distance = 80_000;
      const radius = 50_000;
      const before = cameraFor(0.75, phi, distance);
      const right = new Vector3().setFromMatrixColumn(before.camera.matrixWorld, 0);
      const upAxis = new Vector3().setFromMatrixColumn(before.camera.matrixWorld, 1);
      const rightPoint = new Vector3(before.unit.x, before.unit.y, before.unit.z)
        .addScaledVector(right, 0.15)
        .normalize()
        .multiplyScalar(radius);
      const upPoint = new Vector3(before.unit.x, before.unit.y, before.unit.z)
        .addScaledVector(upAxis, 0.15)
        .normalize()
        .multiplyScalar(radius);
      const rightNdc = project(before.camera, before.cameraWorld, rightPoint);
      const upNdc = project(before.camera, before.cameraWorld, upPoint);
      expect(rightNdc.x).toBeGreaterThan(0.05);
      expect(upNdc.y).toBeGreaterThan(0.05);

      const draggedRight = { theta: 0.75, phi };
      applyOrbitDrag(draggedRight, 40, 0);
      const afterRight = cameraFor(draggedRight.theta, draggedRight.phi, distance);
      const rightDelta =
        project(afterRight.camera, afterRight.cameraWorld, rightPoint).x - rightNdc.x;
      expect(rightDelta).toBeGreaterThan(0);

      const draggedDown = { theta: 0.75, phi };
      applyOrbitDrag(draggedDown, 0, 40);
      const afterDown = cameraFor(draggedDown.theta, draggedDown.phi, distance);
      const downDelta = project(afterDown.camera, afterDown.cameraWorld, upPoint).y - upNdc.y;
      expect(downDelta).toBeLessThan(0);
    }
  });
});
