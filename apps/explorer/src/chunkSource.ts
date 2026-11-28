import { CHUNK_GRID_SIZE, colorChunk, debugChannelMeta } from "@planet/engine";
import type { ChunkRequest, DebugChannelId, Planet } from "@planet/engine";
import type { ChunkMeshPayload, ChunkMeshSource } from "@planet/renderer";

/**
 * Main-thread generator. A worker client can replace this object; the mesh
 * manager only sees {@link ChunkMeshSource}.
 */
export function createPlanetChunkSource(
  getPlanet: () => Planet,
  getChannel: () => DebugChannelId,
): ChunkMeshSource {
  return {
    buildChunk(request: ChunkRequest): ChunkMeshPayload {
      const planet = getPlanet();
      const channel = getChannel();
      const started = performance.now();
      const data = planet.buildChunk(request);
      const colors = colorChunk(planet.params, data, channel);
      return {
        request,
        positions: data.positions,
        normals: data.normals,
        colors,
        indices: data.indices,
        origin: data.origin,
        boundingRadius: data.boundingRadius,
        lit: debugChannelMeta(channel).lit,
        generateMs: performance.now() - started,
        seaRelativeHeight: data.seaRelativeHeight,
        gridSize: CHUNK_GRID_SIZE,
        planetRadius: planet.params.radius,
        seaLevel: planet.params.seaLevel,
      };
    },
  };
}
