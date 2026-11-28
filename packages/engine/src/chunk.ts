import { CUBE_FACE_COUNT, cubeFacePoint, spherifyCube } from "./cubeSphere";
import type { CubeFaceIndex } from "./cubeSphere";
import type { Vec3 } from "./noise/domainWarp";
import type { PlanetParams } from "./params";
import { sampleDirection } from "./sample";
import type { GlobalBake } from "./tectonics/bake";
import { tectonicReliefMeters } from "./tectonics/fields";
import { cross, dot, length, normalize, scale, sub } from "./vec3";

/**
 * Vertices along one edge of a chunk, including the shared border.
 * 32 quads (a power of two) so a coarse edge lines up with two fine edges.
 */
export const CHUNK_GRID_SIZE = 33;

/** Deepest quadtree level. Past this, vertex spacing is centimeters on the default planet. */
export const MAX_CHUNK_LOD = 16;

export interface ChunkRequest {
  face: CubeFaceIndex;
  lod: number;
  /** Tile column in `[0, 2^lod)`. Increases with face `u`. */
  x: number;
  y: number;
}

export interface ChunkData {
  request: ChunkRequest;
  /** Meters, relative to {@link origin}. Safe to store in float32. */
  positions: Float32Array;
  normals: Float32Array;
  /** Radial displacement from the planet radius, meters. One value per vertex. */
  height: Float32Array;
  /** `height - seaLevel`, meters. */
  seaRelativeHeight: Float32Array;
  /** Angle between the normal and the radial direction, radians. */
  slope: Float32Array;
  indices: Uint32Array;
  /**
   * Planet-centered reference point, meters, kept in float64.
   * The renderer places the mesh at `origin - camera`.
   */
  origin: Vec3;
  /** Bounding sphere around `origin`, meters. Includes skirts. */
  boundingRadius: number;
}

interface PatchRange {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

function assertRequest(request: ChunkRequest): void {
  if (!Number.isInteger(request.face) || request.face < 0 || request.face >= CUBE_FACE_COUNT) {
    throw new Error(`chunk face must be an integer from 0 to ${CUBE_FACE_COUNT - 1}`);
  }
  if (!Number.isInteger(request.lod) || request.lod < 0 || request.lod > MAX_CHUNK_LOD) {
    throw new Error(`chunk lod must be an integer from 0 to ${MAX_CHUNK_LOD}`);
  }
  const tiles = 2 ** request.lod;
  if (!Number.isInteger(request.x) || request.x < 0 || request.x >= tiles) {
    throw new Error(`chunk x must be an integer in [0, ${tiles})`);
  }
  if (!Number.isInteger(request.y) || request.y < 0 || request.y >= tiles) {
    throw new Error(`chunk y must be an integer in [0, ${tiles})`);
  }
}

/** Face-parameter rectangle covered by one quadtree node. `u` and `v` run [-1, 1]. */
export function chunkPatch(request: ChunkRequest): PatchRange {
  const tiles = 2 ** request.lod;
  return {
    u0: -1 + (2 * request.x) / tiles,
    u1: -1 + (2 * (request.x + 1)) / tiles,
    v0: -1 + (2 * request.y) / tiles,
    v1: -1 + (2 * (request.y + 1)) / tiles,
  };
}

export function chunkKey(request: ChunkRequest): string {
  return `${request.face}:${request.lod}:${request.x}:${request.y}`;
}

function surfaceVertex(i: number, j: number): number {
  return j * CHUNK_GRID_SIZE + i;
}

function writeVec3(buffer: Float32Array | Float64Array, index: number, value: Vec3): void {
  const offset = index * 3;
  buffer[offset] = value.x;
  buffer[offset + 1] = value.y;
  buffer[offset + 2] = value.z;
}

function readVec3(buffer: Float64Array, index: number): Vec3 {
  const offset = index * 3;
  return {
    x: buffer[offset] ?? 0,
    y: buffer[offset + 1] ?? 0,
    z: buffer[offset + 2] ?? 0,
  };
}

/**
 * Skirt length has to hide a one-level T-junction. The missing midpoint can
 * deviate by about a noise gradient times the chunk edge, which grows with
 * amplitude and noise scale, so a fixed fraction of the edge is not enough
 * at the slider extremes. The cap keeps a wild gradient from pulling the
 * skirt out through the far side of the planet.
 */
function skirtDepth(params: PlanetParams, edgeLength: number): number {
  // Shelves and ranges are steeper than the detail noise, and the skirt has
  // to cover that step at a one-level LOD crack.
  const gradient =
    (Math.abs(params.amplitude) * Math.max(params.noiseScale, 1) + tectonicReliefMeters(params)) *
    (edgeLength / params.radius);
  const depth = Math.max(edgeLength * 0.025, gradient * 2);
  return Math.min(depth, edgeLength * 0.25);
}

function gridNormal(world: Float64Array, i: number, j: number): Vec3 {
  const i0 = Math.max(0, i - 1);
  const i1 = Math.min(CHUNK_GRID_SIZE - 1, i + 1);
  const j0 = Math.max(0, j - 1);
  const j1 = Math.min(CHUNK_GRID_SIZE - 1, j + 1);
  const dx = sub(readVec3(world, surfaceVertex(i1, j)), readVec3(world, surfaceVertex(i0, j)));
  const dy = sub(readVec3(world, surfaceVertex(i, j1)), readVec3(world, surfaceVertex(i, j0)));
  let normal = cross(dx, dy);
  const position = readVec3(world, surfaceVertex(i, j));
  if (dot(normal, position) < 0) normal = scale(normal, -1);
  const magnitude = length(normal);
  if (magnitude < 1e-12) return normalize(position);
  return scale(normal, 1 / magnitude);
}

function pushTriangle(
  indices: Uint32Array,
  cursor: { index: number },
  a: number,
  b: number,
  c: number,
): void {
  indices[cursor.index] = a;
  indices[cursor.index + 1] = b;
  indices[cursor.index + 2] = c;
  cursor.index += 3;
}

/**
 * The skirt faces away from the chunk interior so it covers the crack from
 * the neighbor's side. The sign is chosen per quad because a cube face can
 * flip the apparent winding of an inward offset.
 */
function pushOutwardQuad(
  indices: Uint32Array,
  cursor: { index: number },
  world: Float64Array,
  a: number,
  b: number,
  c: number,
  d: number,
  outward: Vec3,
): void {
  const normal = cross(
    sub(readVec3(world, b), readVec3(world, a)),
    sub(readVec3(world, d), readVec3(world, a)),
  );
  if (dot(normal, outward) >= 0) {
    pushTriangle(indices, cursor, a, b, d);
    pushTriangle(indices, cursor, a, d, c);
  } else {
    pushTriangle(indices, cursor, a, d, b);
    pushTriangle(indices, cursor, a, c, d);
  }
}

/**
 * Chunk mesh for one quadtree node.
 * Positions are meters relative to the center vertex. Callers subtract the
 * camera from `origin` in float64 before writing the mesh matrix, which is
 * what keeps the surface from jittering when the planet is tens of kilometers
 * from the scene origin.
 */
export function buildChunk(
  params: PlanetParams,
  request: ChunkRequest,
  bake?: GlobalBake,
): ChunkData {
  assertRequest(request);
  if (!Number.isFinite(params.radius) || params.radius <= 0) {
    throw new Error("radius must be a finite number > 0");
  }

  const grid = CHUNK_GRID_SIZE;
  const surfaceCount = grid * grid;
  const skirtCount = grid * 4;
  const vertexCount = surfaceCount + skirtCount;
  const { u0, u1, v0, v1 } = chunkPatch(request);
  const world = new Float64Array(vertexCount * 3);
  const height = new Float32Array(vertexCount);
  const seaRelativeHeight = new Float32Array(vertexCount);
  const directions: Vec3[] = new Array(surfaceCount);

  for (let j = 0; j < grid; j++) {
    const v = v0 + ((v1 - v0) * j) / (grid - 1);
    for (let i = 0; i < grid; i++) {
      const u = u0 + ((u1 - u0) * i) / (grid - 1);
      const direction = spherifyCube(cubeFacePoint(request.face, u, v));
      const sample = sampleDirection(params, direction, bake);
      const radial = Math.max(params.radius + sample.height, params.radius * 1e-4);
      const index = surfaceVertex(i, j);
      directions[index] = direction;
      height[index] = sample.height;
      seaRelativeHeight[index] = sample.seaRelativeHeight;
      writeVec3(world, index, scale(direction, radial));
    }
  }

  const centerIndex = surfaceVertex((grid - 1) / 2, (grid - 1) / 2);
  const origin = readVec3(world, centerIndex);

  const normals = new Float32Array(vertexCount * 3);
  const slope = new Float32Array(vertexCount);
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const index = surfaceVertex(i, j);
      const normal = gridNormal(world, i, j);
      writeVec3(normals, index, normal);
      const direction = directions[index];
      if (!direction) throw new Error(`Missing chunk direction ${index}`);
      slope[index] = Math.acos(Math.min(1, Math.max(-1, dot(normal, direction))));
    }
  }

  const midV = (v0 + v1) / 2;
  const edgeLength =
    params.radius *
    angleBetween(
      spherifyCube(cubeFacePoint(request.face, u0, midV)),
      spherifyCube(cubeFacePoint(request.face, u1, midV)),
    );
  const drop = skirtDepth(params, edgeLength);

  const edges: readonly { fixedI: number | null; fixedJ: number | null; skirtEdge: number }[] = [
    { fixedI: 0, fixedJ: null, skirtEdge: 0 },
    { fixedI: grid - 1, fixedJ: null, skirtEdge: 1 },
    { fixedI: null, fixedJ: 0, skirtEdge: 2 },
    { fixedI: null, fixedJ: grid - 1, skirtEdge: 3 },
  ];

  for (const edge of edges) {
    for (let along = 0; along < grid; along++) {
      const i = edge.fixedI ?? along;
      const j = edge.fixedJ ?? along;
      const source = surfaceVertex(i, j);
      const skirt = surfaceCount + edge.skirtEdge * grid + along;
      const surfaceWorld = readVec3(world, source);
      const radial = Math.max(length(surfaceWorld) - drop, params.radius * 1e-4);
      writeVec3(world, skirt, scale(normalize(surfaceWorld), radial));
      const normalOffset = source * 3;
      const skirtNormal = skirt * 3;
      normals[skirtNormal] = normals[normalOffset] ?? 0;
      normals[skirtNormal + 1] = normals[normalOffset + 1] ?? 0;
      normals[skirtNormal + 2] = normals[normalOffset + 2] ?? 0;
      height[skirt] = height[source] ?? 0;
      seaRelativeHeight[skirt] = seaRelativeHeight[source] ?? 0;
      slope[skirt] = slope[source] ?? 0;
    }
  }

  const surfaceQuads = (grid - 1) * (grid - 1);
  const skirtQuads = 4 * (grid - 1);
  const indices = new Uint32Array((surfaceQuads + skirtQuads) * 6);
  const cursor = { index: 0 };
  for (let j = 0; j < grid - 1; j++) {
    for (let i = 0; i < grid - 1; i++) {
      const a = surfaceVertex(i, j);
      const b = surfaceVertex(i + 1, j);
      const c = surfaceVertex(i, j + 1);
      const d = surfaceVertex(i + 1, j + 1);
      // Same winding as the single-resolution cube sphere: outward on every face.
      pushTriangle(indices, cursor, a, b, d);
      pushTriangle(indices, cursor, a, d, c);
    }
  }

  for (const edge of edges) {
    for (let along = 0; along < grid - 1; along++) {
      const i = edge.fixedI ?? along;
      const j = edge.fixedJ ?? along;
      const i1 = edge.fixedI ?? along + 1;
      const j1 = edge.fixedJ ?? along + 1;
      const a = surfaceVertex(i, j);
      const b = surfaceVertex(i1, j1);
      const c = surfaceCount + edge.skirtEdge * grid + along;
      const d = c + 1;
      const outward = sub(readVec3(world, a), origin);
      pushOutwardQuad(indices, cursor, world, a, b, c, d, outward);
    }
  }
  if (cursor.index !== indices.length) {
    throw new Error(`chunk indices wrote ${cursor.index} of ${indices.length}`);
  }

  const positions = new Float32Array(vertexCount * 3);
  let boundingRadius = 0;
  for (let index = 0; index < vertexCount; index++) {
    const point = readVec3(world, index);
    const local = sub(point, origin);
    writeVec3(positions, index, local);
    boundingRadius = Math.max(boundingRadius, length(local));
  }

  return {
    request,
    positions,
    normals,
    height,
    seaRelativeHeight,
    slope,
    indices,
    origin,
    boundingRadius: boundingRadius + 0.5,
  };
}

function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
}

/** Unit direction of a chunk vertex, including skirt vertices copied from their edge. */
export function chunkVertexDirection(request: ChunkRequest, index: number): Vec3 {
  const grid = CHUNK_GRID_SIZE;
  const surfaceCount = grid * grid;
  const vertexCount = surfaceCount + grid * 4;
  if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
    throw new Error(`chunk vertex ${index} is outside 0..${vertexCount - 1}`);
  }
  let i: number;
  let j: number;
  if (index < surfaceCount) {
    i = index % grid;
    j = Math.floor(index / grid);
  } else {
    const alongEdge = index - surfaceCount;
    const edge = Math.floor(alongEdge / grid);
    const along = alongEdge - edge * grid;
    if (edge === 0) {
      i = 0;
      j = along;
    } else if (edge === 1) {
      i = grid - 1;
      j = along;
    } else if (edge === 2) {
      i = along;
      j = 0;
    } else {
      i = along;
      j = grid - 1;
    }
  }
  const { u0, u1, v0, v1 } = chunkPatch(request);
  const u = u0 + ((u1 - u0) * i) / (grid - 1);
  const v = v0 + ((v1 - v0) * j) / (grid - 1);
  return spherifyCube(cubeFacePoint(request.face, u, v));
}
