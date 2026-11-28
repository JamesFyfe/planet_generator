import { describe, expect, it } from "vitest";
import type { ChunkRequest } from "@planet/engine";
import { chunkCovers, chunksToDisplay, chunkParent } from "./chunkCoverage";

const node = (lod: number, x: number, y: number, face: ChunkRequest["face"] = 0): ChunkRequest => ({
  face,
  lod,
  x,
  y,
});

function keys(chunks: readonly ChunkRequest[]): string[] {
  return chunks.map((chunk) => `${chunk.face}:${chunk.lod}:${chunk.x}:${chunk.y}`).sort();
}

describe("chunk coverage", () => {
  it("finds the parent tile", () => {
    expect(chunkParent(node(0, 0, 0))).toBeNull();
    expect(chunkParent(node(3, 5, 6))).toEqual(node(2, 2, 3));
  });

  it("treats a node as covering itself and its descendants", () => {
    expect(chunkCovers(node(1, 1, 1), node(1, 1, 1))).toBe(true);
    expect(chunkCovers(node(1, 1, 1), node(3, 6, 7))).toBe(true);
    expect(chunkCovers(node(1, 1, 1), node(3, 3, 7))).toBe(false);
    expect(chunkCovers(node(2, 0, 0), node(1, 0, 0))).toBe(false);
  });

  it("keeps a parent until every selected child is available", () => {
    const parent = node(0, 0, 0);
    const children = [node(1, 0, 0), node(1, 1, 0), node(1, 0, 1), node(1, 1, 1)];
    expect(keys(chunksToDisplay(children, [parent]))).toEqual(keys([parent]));
    const [first, second] = children;
    if (!first || !second) throw new Error("expected two children");
    expect(keys(chunksToDisplay(children, [parent, first, second]))).toEqual(keys([parent]));
    expect(keys(chunksToDisplay(children, [parent, ...children]))).toEqual(keys(children));
  });

  it("keeps resident children until a coarser selection is available", () => {
    const parent = node(0, 0, 0);
    const children = [node(1, 0, 0), node(1, 1, 0), node(1, 0, 1), node(1, 1, 1)];
    expect(keys(chunksToDisplay([parent], children))).toEqual(keys(children));
    expect(keys(chunksToDisplay([parent], [parent, ...children]))).toEqual(keys([parent]));
  });

  it("shows an available leaf that has no fallback yet", () => {
    const leaf = node(2, 1, 1);
    expect(keys(chunksToDisplay([leaf], [leaf]))).toEqual(keys([leaf]));
    expect(chunksToDisplay([leaf], [])).toEqual([]);
  });
});
