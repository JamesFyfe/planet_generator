import type { ChunkData } from "./chunk";
import { chunkVertexDirection } from "./chunk";
import { colorForChannel } from "./debugChannels";
import type { DebugChannelId } from "./debugChannels";
import type { PlanetParams } from "./params";
import type { PlanetSample } from "./sample";
import type { GlobalBake } from "./tectonics/bake";
import { getGlobalBake } from "./tectonics/bake";

const TECTONIC_CHANNELS: ReadonlySet<DebugChannelId> = new Set([
  "plate",
  "boundary",
  "uplift",
  "crust",
  "hotspot",
]);

function tectonicSample(
  bake: GlobalBake,
  chunk: ChunkData,
  index: number,
): Pick<
  PlanetSample,
  "plateId" | "crust" | "boundary" | "boundaryDistance" | "uplift" | "hotspot"
> {
  const fields = bake.sample(chunkVertexDirection(chunk.request, index));
  return {
    plateId: fields.plateId,
    crust: fields.crust,
    boundary: fields.boundary,
    boundaryDistance: fields.boundaryDistance,
    uplift: fields.uplift,
    hotspot: fields.hotspot,
  };
}

/** Vertex colors for an already-built chunk. Geometry stays cached when only the channel changes. */
export function colorChunk(
  params: PlanetParams,
  chunk: ChunkData,
  channel: DebugChannelId,
  bake?: GlobalBake,
): Float32Array {
  const count = chunk.height.length;
  const colors = new Float32Array(count * 3);
  const fields = TECTONIC_CHANNELS.has(channel) ? (bake ?? getGlobalBake(params)) : undefined;
  const blank = {
    plateId: 0,
    crust: 0,
    boundary: 0,
    boundaryDistance: 1,
    uplift: 0,
    hotspot: 0,
  };
  for (let index = 0; index < count; index++) {
    const tectonic = fields ? tectonicSample(fields, chunk, index) : blank;
    const rgb = colorForChannel(
      channel,
      params,
      {
        height: chunk.height[index] ?? 0,
        seaRelativeHeight: chunk.seaRelativeHeight[index] ?? 0,
        ...tectonic,
      },
      chunk.slope[index] ?? 0,
      chunk.request.lod,
    );
    const offset = index * 3;
    colors[offset] = rgb[0];
    colors[offset + 1] = rgb[1];
    colors[offset + 2] = rgb[2];
  }
  return colors;
}
