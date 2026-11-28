import type { PlanetParams, Vec3 } from "@planet/engine";
import type { Object3D, PerspectiveCamera } from "three";
import type { ChunkMeshPayload } from "../chunkMeshes";

/**
 * One frame of renderer state. `timeSeconds` is supplied by the app.
 * The engine never sees it.
 */
export interface PlanetRenderState {
  params: PlanetParams;
  timeSeconds: number;
  cameraWorld: Vec3;
  camera: PerspectiveCamera;
  /** Unit vector from the planet center toward the sun. */
  sunDirection: Vec3;
  /** Planet spin in radians, same angle the sun and the stars share. */
  spinAngle: number;
}

/**
 * A full-screen or shell effect: stars, lighting, atmosphere, clouds.
 * Register a new one in `createPlanetVisuals`.
 */
export interface PlanetLayer {
  readonly name: string;
  update(state: PlanetRenderState): void;
  dispose(): void;
}

/**
 * Geometry that must share a terrain chunk's floating origin.
 * The mesh manager parents the object to the chunk mesh, whose
 * translation is `origin - camera` computed in float64.
 */
export interface ChunkAttachment {
  readonly name: string;
  create(payload: ChunkMeshPayload): Object3D | null;
  dispose(object: Object3D): void;
}
