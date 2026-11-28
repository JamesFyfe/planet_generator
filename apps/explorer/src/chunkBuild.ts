import { colorChunk, createPlanet, debugChannelMeta } from "@planet/engine";
import type { ChunkRequest, DebugChannelId, PlanetParams } from "@planet/engine";
import type { ChunkMeshPayload } from "@planet/renderer";

/**
 * One chunk, colored for the debug channel.
 * Runs in a worker. The typed arrays own their buffers so the worker can
 * transfer them instead of structured-cloning a copy.
 */
export function buildChunkPayload(
  params: PlanetParams,
  channel: DebugChannelId,
  request: ChunkRequest,
): ChunkMeshPayload {
  const started = performance.now();
  const planet = createPlanet(params);
  const data = planet.buildChunk(request);
  return {
    request,
    positions: data.positions,
    normals: data.normals,
    colors: colorChunk(params, data, channel),
    indices: data.indices,
    seaRelativeHeight: data.seaRelativeHeight,
    slope: data.slope,
    biomeId: data.biomeId,
    biomeSecondary: data.biomeSecondary,
    biomeWeight: data.biomeWeight,
    materialId: data.materialId,
    origin: data.origin,
    boundingRadius: data.boundingRadius,
    lit: debugChannelMeta(channel).lit,
    generateMs: performance.now() - started,
  };
}

export function chunkPayloadBuffers(payload: ChunkMeshPayload): ArrayBuffer[] {
  const views: ArrayBufferView[] = [
    payload.positions,
    payload.normals,
    payload.colors,
    payload.indices,
  ];
  if (payload.seaRelativeHeight) views.push(payload.seaRelativeHeight);
  if (payload.slope) views.push(payload.slope);
  if (payload.biomeId) views.push(payload.biomeId);
  if (payload.biomeSecondary) views.push(payload.biomeSecondary);
  if (payload.biomeWeight) views.push(payload.biomeWeight);
  if (payload.materialId) views.push(payload.materialId);
  return views.map((view) => {
    if (!(view.buffer instanceof ArrayBuffer)) {
      throw new Error("Chunk buffers must be transferable ArrayBuffers");
    }
    return view.buffer;
  });
}
