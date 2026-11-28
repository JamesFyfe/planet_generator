import { expose, transfer } from "comlink";
import type { ChunkRequest, DebugChannelId, PlanetParams } from "@planet/engine";
import type { ChunkMeshPayload } from "@planet/renderer";
import { buildChunkPayload, chunkPayloadBuffers } from "./chunkBuild";

const api = {
  build(params: PlanetParams, channel: DebugChannelId, request: ChunkRequest): ChunkMeshPayload {
    const payload = buildChunkPayload(params, channel, request);
    return transfer(payload, chunkPayloadBuffers(payload));
  },
};

export type ChunkWorkerApi = typeof api;

expose(api);
