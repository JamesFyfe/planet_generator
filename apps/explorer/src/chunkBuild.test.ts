import { createPlanet, defaultPlanetParams } from "@planet/engine";
import { describe, expect, it } from "vitest";
import { buildChunkPayload, chunkPayloadBuffers } from "./chunkBuild";

describe("buildChunkPayload", () => {
  it("matches the engine mesh and is deterministic", () => {
    const params = defaultPlanetParams();
    const request = { face: 0 as const, lod: 1, x: 1, y: 0 };
    const planet = createPlanet(params);
    const direct = planet.buildChunk(request);
    const first = buildChunkPayload(params, "terrain", request);
    const second = buildChunkPayload(params, "terrain", request);
    expect(Array.from(first.positions)).toEqual(Array.from(direct.positions));
    expect(Array.from(first.normals)).toEqual(Array.from(direct.normals));
    expect(Array.from(first.indices)).toEqual(Array.from(direct.indices));
    expect(Array.from(first.colors)).toEqual(Array.from(second.colors));
    expect(first.origin).toEqual(second.origin);
    expect(first.boundingRadius).toBe(second.boundingRadius);
    expect(first.lit).toBe(true);
    const buffers = chunkPayloadBuffers(first);
    expect(buffers).toHaveLength(6);
    expect(first.slope).toBeDefined();
    expect(first.seaRelativeHeight).toBeDefined();
    expect(buffers.every((buffer) => buffer instanceof ArrayBuffer)).toBe(true);
  });

  it("changes colors with the debug channel without changing positions", () => {
    const params = defaultPlanetParams();
    const request = { face: 2 as const, lod: 0, x: 0, y: 0 };
    const terrain = buildChunkPayload(params, "terrain", request);
    const height = buildChunkPayload(params, "height", request);
    expect(Array.from(terrain.positions)).toEqual(Array.from(height.positions));
    expect(Array.from(terrain.colors)).not.toEqual(Array.from(height.colors));
    expect(height.lit).toBe(false);
  });
});
