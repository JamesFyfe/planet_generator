import type { Group } from "three";
import { spinAngle, sunDirection } from "./lighting";
import { createAtmosphereLayer } from "./layers/atmosphere";
import { createCloudLayer } from "./layers/clouds";
import { createLightingLayer } from "./layers/lightingLayer";
import { createStarLayer } from "./layers/stars";
import type { ChunkAttachment, PlanetLayer, PlanetRenderState } from "./layers/types";
import { createWaterLayer } from "./layers/water";
import type { WaterLayer } from "./layers/water";

export interface PlanetVisualFrame {
  params: PlanetRenderState["params"];
  timeSeconds: number;
  cameraWorld: PlanetRenderState["cameraWorld"];
  camera: PlanetRenderState["camera"];
}

export interface PlanetVisuals {
  /** Draw order is each mesh's renderOrder, not this list. */
  readonly layers: readonly PlanetLayer[];
  readonly waterAttachment: ChunkAttachment;
  update(frame: PlanetVisualFrame): void;
  dispose(): void;
}

/**
 * Scene layers live here. To add one:
 * 1. Implement `PlanetLayer` (shell, sky, or light) or `ChunkAttachment`
 *    when the geometry must share a terrain chunk's floating origin.
 * 2. Construct it below and, for a scene layer, append it to `layers`.
 * 3. Read parameters and `timeSeconds` from the frame. Do not read a clock,
 *    and do not import React.
 * Chunk attachments are parented by `createChunkMeshManager`.
 */
export function createPlanetVisuals(parent: Group): PlanetVisuals {
  const water: WaterLayer = createWaterLayer();
  const layers: PlanetLayer[] = [
    createStarLayer(parent),
    createLightingLayer(parent),
    createAtmosphereLayer(parent),
    createCloudLayer(parent),
  ];
  return {
    layers,
    waterAttachment: water.attachment,
    update(frame: PlanetVisualFrame): void {
      const state: PlanetRenderState = {
        ...frame,
        sunDirection: sunDirection(
          frame.params.axialTilt,
          frame.params.rotationPeriod,
          frame.timeSeconds,
        ),
        spinAngle: spinAngle(frame.params.rotationPeriod, frame.timeSeconds),
      };
      for (const layer of layers) layer.update(state);
      water.update(state);
    },
    dispose(): void {
      for (const layer of layers) layer.dispose();
      water.dispose();
    },
  };
}
