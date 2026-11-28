import { describe, expect, it } from "vitest";
import { formatChunkStats } from "./chunkStats";

describe("formatChunkStats", () => {
  it("shows chunk count, generation time, and max LOD", () => {
    expect(
      formatChunkStats({
        chunkCount: 18,
        visibleCount: 11,
        maxLod: 6,
        lastGenerateMs: 3.24,
        averageGenerateMs: 2.5,
      }),
    ).toBe(
      ["Chunks 18", "Visible 11", "Generate 3.2 ms", "Average 2.5 ms", "Max LOD 6"].join("\n"),
    );
  });
});
