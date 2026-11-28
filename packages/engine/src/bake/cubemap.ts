import { cubeFaceIndex, cubeFacePoint, cubeFaceUv, spherifyCube } from "../cubeSphere";
import type { CubeFaceIndex } from "../cubeSphere";
import type { Vec3 } from "../noise/domainWarp";

/**
 * Samples along one edge of each cube face. Climate and hydrology append
 * channels to the same bake instead of allocating another map.
 */
export const BAKE_RESOLUTION = 512;

export const CUBE_MAP_FACE_COUNT = 6;

export interface ChannelSpec {
  id: string;
  /** Categories stay on one texel. Scalars blend, including across a cube edge. */
  filter: "bilinear" | "nearest";
}

/**
 * One producer fills a contiguous slice of the per-texel output.
 * A later phase adds a source; it does not walk the sphere again.
 */
export interface BakeFieldSource {
  readonly specs: readonly ChannelSpec[];
  write(dir: Vec3, out: Float64Array, offset: number): void;
}

export interface Cubemap {
  readonly resolution: number;
  /** Face-major, length `6 * resolution * resolution`. */
  readonly data: Float32Array;
}

export interface CubemapSet {
  readonly resolution: number;
  readonly specs: readonly ChannelSpec[];
  readonly maps: readonly Cubemap[];
  sample(id: string, dir: Vec3): number;
}

const scratch = { x: 0, y: 0, z: 0 };
const cubeScratch = { x: 0, y: 0, z: 0 };

function texelCount(resolution: number): number {
  return CUBE_MAP_FACE_COUNT * resolution * resolution;
}

function texelIndex(face: number, resolution: number, i: number, j: number): number {
  return (face * resolution + j) * resolution + i;
}

/**
 * A sample half a texel past an edge belongs to the neighbor face.
 * Both faces then blend the same pair of texels, so the value meets at the edge.
 */
function readTexel(
  data: Float32Array,
  resolution: number,
  face: number,
  i: number,
  j: number,
): number {
  if (i >= 0 && j >= 0 && i < resolution && j < resolution) {
    return data[texelIndex(face, resolution, i, j)] ?? 0;
  }
  const u = ((i + 0.5) / resolution) * 2 - 1;
  const v = ((j + 0.5) / resolution) * 2 - 1;
  cubeFacePoint(face, u, v, scratch);
  const dominant = Math.max(Math.abs(scratch.x), Math.abs(scratch.y), Math.abs(scratch.z));
  if (!(dominant > 0)) return 0;
  scratch.x /= dominant;
  scratch.y /= dominant;
  scratch.z /= dominant;
  const next = cubeFaceIndex(scratch);
  const uv = cubeFaceUv(next, scratch);
  let ni = Math.floor(((uv.u + 1) / 2) * resolution);
  let nj = Math.floor(((uv.v + 1) / 2) * resolution);
  if (ni < 0) ni = 0;
  else if (ni >= resolution) ni = resolution - 1;
  if (nj < 0) nj = 0;
  else if (nj >= resolution) nj = resolution - 1;
  return data[texelIndex(next, resolution, ni, nj)] ?? 0;
}

function faceOf(x: number, y: number, z: number): { face: CubeFaceIndex; u: number; v: number } {
  scratch.x = x;
  scratch.y = y;
  scratch.z = z;
  const face = cubeFaceIndex(scratch);
  const dominant = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  cubeScratch.x = x / dominant;
  cubeScratch.y = y / dominant;
  cubeScratch.z = z / dominant;
  const uv = cubeFaceUv(face, cubeScratch);
  return { face, u: uv.u, v: uv.v };
}

function clampUnit(value: number, resolution: number): number {
  const max = resolution - 0.5;
  if (value < -0.5) return -0.5;
  if (value > max) return max;
  return value;
}

/** Bilinear sample forced onto one face. `u` and `v` are cube coordinates in [-1, 1]. */
export function sampleCubemapFace(
  map: Cubemap,
  face: number,
  u: number,
  v: number,
  filter: ChannelSpec["filter"],
): number {
  const resolution = map.resolution;
  const x = clampUnit(((u + 1) / 2) * resolution - 0.5, resolution);
  const y = clampUnit(((v + 1) / 2) * resolution - 0.5, resolution);
  if (filter === "nearest") {
    const i = Math.round(x);
    const j = Math.round(y);
    return readTexel(map.data, resolution, face, i, j);
  }
  const i0 = Math.floor(x);
  const j0 = Math.floor(y);
  const tx = x - i0;
  const ty = y - j0;
  const v00 = readTexel(map.data, resolution, face, i0, j0);
  const v10 = readTexel(map.data, resolution, face, i0 + 1, j0);
  const v01 = readTexel(map.data, resolution, face, i0, j0 + 1);
  const v11 = readTexel(map.data, resolution, face, i0 + 1, j0 + 1);
  const row0 = v00 + (v10 - v00) * tx;
  const row1 = v01 + (v11 - v01) * tx;
  return row0 + (row1 - row0) * ty;
}

export function sampleCubemap(map: Cubemap, dir: Vec3, filter: ChannelSpec["filter"]): number {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (!Number.isFinite(len) || len === 0) {
    throw new Error("direction must be a finite non-zero vector");
  }
  const { face, u, v } = faceOf(dir.x / len, dir.y / len, dir.z / len);
  return sampleCubemapFace(map, face, u, v, filter);
}

function assertResolution(resolution: number): void {
  if (!Number.isInteger(resolution) || resolution < 2 || resolution > 2048) {
    throw new Error("bake resolution must be an integer from 2 to 2048");
  }
}

/**
 * Fill every channel in one pass. `sample` writes `specs.length` values for
 * the unit direction of each texel.
 */
export function fillCubemaps(
  resolution: number,
  specs: readonly ChannelSpec[],
  sample: (dir: Vec3, out: Float64Array) => void,
): CubemapSet {
  assertResolution(resolution);
  if (specs.length === 0) throw new Error("bake needs at least one channel");
  const ids = new Set<string>();
  for (const spec of specs) {
    if (ids.has(spec.id)) throw new Error(`duplicate bake channel "${spec.id}"`);
    ids.add(spec.id);
  }

  const texels = texelCount(resolution);
  const maps: Cubemap[] = specs.map(() => ({
    resolution,
    data: new Float32Array(texels),
  }));
  const dir = { x: 0, y: 0, z: 0 };
  const cube = { x: 0, y: 0, z: 0 };
  const out = new Float64Array(specs.length);

  for (let face = 0; face < CUBE_MAP_FACE_COUNT; face++) {
    for (let j = 0; j < resolution; j++) {
      const v = ((j + 0.5) / resolution) * 2 - 1;
      for (let i = 0; i < resolution; i++) {
        const u = ((i + 0.5) / resolution) * 2 - 1;
        cubeFacePoint(face, u, v, cube);
        spherifyCube(cube, dir);
        sample(dir, out);
        const index = texelIndex(face, resolution, i, j);
        for (let channel = 0; channel < specs.length; channel++) {
          const map = maps[channel];
          if (!map) continue;
          map.data[index] = out[channel] ?? 0;
        }
      }
    }
  }

  const byId = new Map<string, { map: Cubemap; filter: ChannelSpec["filter"] }>();
  specs.forEach((spec, index) => {
    const map = maps[index];
    if (!map) return;
    byId.set(spec.id, { map, filter: spec.filter });
  });

  return {
    resolution,
    specs,
    maps,
    sample(id: string, direction: Vec3): number {
      const channel = byId.get(id);
      if (!channel) throw new Error(`Unknown bake channel "${id}"`);
      return sampleCubemap(channel.map, direction, channel.filter);
    },
  };
}

export function bakeFieldSources(
  resolution: number,
  sources: readonly BakeFieldSource[],
): CubemapSet {
  const specs = sources.flatMap((source) => source.specs);
  return fillCubemaps(resolution, specs, (dir, out) => {
    let offset = 0;
    for (const source of sources) {
      source.write(dir, out, offset);
      offset += source.specs.length;
    }
  });
}

export function cubemapSetFromChannels(
  resolution: number,
  channels: readonly { id: string; filter: ChannelSpec["filter"]; data: Float32Array }[],
): CubemapSet {
  assertResolution(resolution);
  const expected = texelCount(resolution);
  const specs: ChannelSpec[] = [];
  const maps: Cubemap[] = [];
  const byId = new Map<string, { map: Cubemap; filter: ChannelSpec["filter"] }>();
  for (const channel of channels) {
    if (channel.data.length !== expected) {
      throw new Error(
        `bake channel "${channel.id}" has ${channel.data.length} texels, expected ${expected}`,
      );
    }
    if (byId.has(channel.id)) throw new Error(`duplicate bake channel "${channel.id}"`);
    const spec = { id: channel.id, filter: channel.filter };
    const map = { resolution, data: channel.data };
    specs.push(spec);
    maps.push(map);
    byId.set(channel.id, { map, filter: channel.filter });
  }
  return {
    resolution,
    specs,
    maps,
    sample(id: string, direction: Vec3): number {
      const channel = byId.get(id);
      if (!channel) throw new Error(`Unknown bake channel "${id}"`);
      return sampleCubemap(channel.map, direction, channel.filter);
    },
  };
}
