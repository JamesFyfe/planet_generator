import type { ChunkMeshStats } from "@planet/renderer";

export function formatChunkStats(stats: ChunkMeshStats): string {
  return [
    `Chunks ${stats.chunkCount}`,
    `Visible ${stats.visibleCount}`,
    `Generate ${stats.lastGenerateMs.toFixed(1)} ms`,
    `Average ${stats.averageGenerateMs.toFixed(1)} ms`,
    `Max LOD ${stats.maxLod}`,
  ].join("\n");
}
