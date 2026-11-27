import type { ChunkData } from "./chunk";
import { colorForChannel } from "./debugChannels";
import type { DebugChannelId } from "./debugChannels";
import type { PlanetParams } from "./params";

/** Vertex colors for an already-built chunk. Geometry stays cached when only the channel changes. */
export function colorChunk(
  params: PlanetParams,
  chunk: ChunkData,
  channel: DebugChannelId,
): Float32Array {
  const count = chunk.height.length;
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    const rgb = colorForChannel(
      channel,
      params,
      {
        height: chunk.height[index] ?? 0,
        seaRelativeHeight: chunk.seaRelativeHeight[index] ?? 0,
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
