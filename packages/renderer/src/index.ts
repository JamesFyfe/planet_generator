/**
 * three.js meshes and materials. This package imports engine types only;
 * the explorer evaluates the planet and passes the typed arrays in.
 */
export const RENDERER_PACKAGE = "@planet/renderer";

export { createPlanetMesh, disposePlanetMesh } from "./planetMesh";
export { createChunkMeshManager } from "./chunkMeshes";
export { createPlanetVisuals } from "./visuals";
export {
  cameraInsideAtmosphere,
  directSunTransmittance,
  isAtmosphereEnabled,
  sunDirection,
} from "./lighting";

export type {
  ChunkMeshFrame,
  ChunkMeshManager,
  ChunkMeshPayload,
  ChunkMeshSource,
  ChunkMeshStats,
} from "./chunkMeshes";
export type { PlanetVisualFrame, PlanetVisuals } from "./visuals";
export type { ChunkAttachment, PlanetLayer, PlanetRenderState } from "./layers/types";
