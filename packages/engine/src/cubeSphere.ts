import { colorForChannel, debugChannelMeta, isDebugChannelId } from "./debugChannels";
import type { DebugChannelId } from "./debugChannels";
import type { Vec3 } from "./noise/domainWarp";
import { surfaceFrame } from "./sample";
import type { Planet } from "./sample";

/** Segments along one edge of a cube face. Phase 1 is this resolution only. */
export const PLANET_MESH_SEGMENTS = 128;

interface CubeFace {
  n: readonly [number, number, number];
  u: readonly [number, number, number];
  v: readonly [number, number, number];
}

/**
 * `u × v` is the outward axis. Grid triangles increase `u` then `v`, so they
 * face outward without a per-face winding flip.
 */
const CUBE_FACES: readonly CubeFace[] = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

/** One quadtree per cube face. Face 0 is +X, then -X, +Y, -Y, +Z, -Z. */
export const CUBE_FACE_COUNT = CUBE_FACES.length;

export type CubeFaceIndex = 0 | 1 | 2 | 3 | 4 | 5;

function cubeFace(face: number): CubeFace {
  if (!Number.isInteger(face) || face < 0 || face >= CUBE_FACE_COUNT) {
    throw new Error(`cube face must be an integer from 0 to ${CUBE_FACE_COUNT - 1}`);
  }
  const entry = CUBE_FACES[face];
  if (!entry) throw new Error(`Missing cube face ${face}`);
  return entry;
}

/** Cube-face point with `u` and `v` in [-1, 1], before spherification. */
export function cubeFacePoint(face: number, u: number, v: number): Vec3 {
  const out = { x: 0, y: 0, z: 0 };
  writeCubeFacePoint(face, u, v, out);
  return out;
}

/** Same point as {@link cubeFacePoint}, written into `out` so the LOD loop can reuse it. */
export function writeCubeFacePoint(face: number, u: number, v: number, out: Vec3): void {
  const entry = cubeFace(face);
  out.x = entry.n[0] + entry.u[0] * u + entry.v[0] * v;
  out.y = entry.n[1] + entry.u[1] * u + entry.v[1] * v;
  out.z = entry.n[2] + entry.u[2] * u + entry.v[2] * v;
}

/** Inverse of {@link cubeFacePoint} for a point on that face. */
export function cubeFaceUv(face: number, point: Vec3): { u: number; v: number } {
  const entry = cubeFace(face);
  return {
    u: point.x * entry.u[0] + point.y * entry.u[1] + point.z * entry.u[2],
    v: point.x * entry.v[0] + point.y * entry.v[1] + point.z * entry.v[2],
  };
}

/**
 * Face whose axis is the dominant component. Used to step off a shared edge
 * onto the neighboring face; callers should not pass the origin.
 */
export function cubeFaceIndex(point: Vec3): CubeFaceIndex {
  const ax = Math.abs(point.x);
  const ay = Math.abs(point.y);
  const az = Math.abs(point.z);
  if (ax >= ay && ax >= az) return point.x >= 0 ? 0 : 1;
  if (ay >= ax && ay >= az) return point.y >= 0 ? 2 : 3;
  return point.z >= 0 ? 4 : 5;
}

export interface PlanetMeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  lit: boolean;
}

function facePoint(face: CubeFace, t: number, s: number): Vec3 {
  return {
    x: face.n[0] + face.u[0] * t + face.v[0] * s,
    y: face.n[1] + face.u[1] * t + face.v[1] * s,
    z: face.n[2] + face.u[2] * t + face.v[2] * s,
  };
}

/**
 * Spherified-cube map (Nowell). Normalizing a cube bunches quads toward the
 * edges; this polynomial keeps vertex spacing roughly even, and it is
 * continuous so shared edges land on the same point.
 */
export function spherifyCube(point: Vec3): Vec3 {
  const out = { x: 0, y: 0, z: 0 };
  writeSpherifyCube(point, out);
  return out;
}

/** Same map as {@link spherifyCube}, written into `out`. `point` and `out` may be the same object. */
export function writeSpherifyCube(point: Vec3, out: Vec3): void {
  const x2 = point.x * point.x;
  const y2 = point.y * point.y;
  const z2 = point.z * point.z;
  // A corner can dip the radicand under zero by an ulp. Clamp, then project back to the sphere.
  const x = point.x * Math.sqrt(Math.max(0, 1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3));
  const y = point.y * Math.sqrt(Math.max(0, 1 - x2 / 2 - z2 / 2 + (x2 * z2) / 3));
  const z = point.z * Math.sqrt(Math.max(0, 1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3));
  const magnitude = Math.hypot(x, y, z);
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new Error("direction must be a finite non-zero vector");
  }
  const scale = 1 / magnitude;
  out.x = x * scale;
  out.y = y * scale;
  out.z = z * scale;
}

/**
 * Single-resolution cube sphere.
 * Positions are planet-centered and divided by radius (`1 + height / radius`),
 * so the vertex buffer stays near unit length instead of storing raw meter-scale
 * float32 coordinates. Edge vertices are duplicated per face; the map and the
 * finite-difference normal are both functions of direction, so the duplicates match.
 */
export function buildPlanetMesh(
  planet: Planet,
  channel: DebugChannelId,
  segments: number = PLANET_MESH_SEGMENTS,
): PlanetMeshData {
  if (!Number.isInteger(segments) || segments < 1 || segments > 256) {
    throw new Error("segments must be an integer from 1 to 256");
  }
  if (!isDebugChannelId(channel)) {
    throw new Error(`Unknown debug channel "${String(channel)}"`);
  }

  const stride = segments + 1;
  const perFace = stride * stride;
  const vertexCount = CUBE_FACES.length * perFace;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(CUBE_FACES.length * segments * segments * 6);

  let vertex = 0;
  let index = 0;
  for (let faceIndex = 0; faceIndex < CUBE_FACES.length; faceIndex++) {
    const face = CUBE_FACES[faceIndex];
    if (!face) throw new Error(`Missing cube face ${faceIndex}`);
    const faceBase = faceIndex * perFace;
    for (let j = 0; j <= segments; j++) {
      const s = (j / segments) * 2 - 1;
      for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * 2 - 1;
        const frame = surfaceFrame(planet.params, spherifyCube(facePoint(face, t, s)));
        const offset = vertex * 3;
        positions[offset] = frame.position.x;
        positions[offset + 1] = frame.position.y;
        positions[offset + 2] = frame.position.z;
        normals[offset] = frame.normal.x;
        normals[offset + 1] = frame.normal.y;
        normals[offset + 2] = frame.normal.z;
        const rgb = colorForChannel(channel, planet.params, frame.sample, frame.slope);
        colors[offset] = rgb[0];
        colors[offset + 1] = rgb[1];
        colors[offset + 2] = rgb[2];
        vertex += 1;
      }
    }
    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < segments; i++) {
        const a = faceBase + j * stride + i;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices[index] = a;
        indices[index + 1] = b;
        indices[index + 2] = d;
        indices[index + 3] = a;
        indices[index + 4] = d;
        indices[index + 5] = c;
        index += 6;
      }
    }
  }

  return {
    positions,
    normals,
    colors,
    indices,
    lit: debugChannelMeta(channel).lit,
  };
}
