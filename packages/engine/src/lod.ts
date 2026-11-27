import { CHUNK_GRID_SIZE, MAX_CHUNK_LOD, chunkKey, chunkPatch } from "./chunk";
import type { ChunkRequest } from "./chunk";
import {
  CUBE_FACE_COUNT,
  cubeFaceIndex,
  cubeFacePoint,
  cubeFaceUv,
  spherifyCube,
} from "./cubeSphere";
import type { CubeFaceIndex } from "./cubeSphere";
import type { Vec3 } from "./noise/domainWarp";
import { dot, length, scale, sub } from "./vec3";

/** Split a chunk when its geometric error projects larger than this many pixels. */
export const DEFAULT_PIXEL_ERROR = 4;

/**
 * Edge-adjacent chunks stay within one LOD of each other.
 * A wider gap leaves a crack taller than the skirt is built to hide.
 */
export const MAX_LOD_GAP = 1;

/** Safety stop so a bad pixel threshold cannot request millions of leaves. */
export const DEFAULT_MAX_CHUNKS = 2048;

export interface LodSelectionInput {
  /** Planet-centered camera position, meters. */
  cameraPosition: Vec3;
  /** Planet radius, meters. Not read from a global. */
  radius: number;
  /** Vertical field of view, radians. */
  fovY: number;
  /** Viewport height in pixels. */
  screenHeight: number;
  /**
   * Max |displacement| in meters. Checked so callers can pass amplitude, but
   * the split distance uses the mean sphere. Inflating every bound by the
   * full amplitude would force a max-LOD disk the size of the mountains.
   */
  relief?: number;
  pixelError?: number;
  maxLod?: number;
  maxChunks?: number;
}

interface ChunkMetric {
  center: Vec3;
  /** Chord radius of the mean-sphere patch, without terrain relief. */
  geometricRadius: number;
  geometricError: number;
}

function assertInput(input: LodSelectionInput): void {
  if (!Number.isFinite(input.radius) || input.radius <= 0) {
    throw new Error("radius must be a finite number > 0");
  }
  if (!Number.isFinite(input.fovY) || input.fovY <= 0 || input.fovY >= Math.PI) {
    throw new Error("fovY must be a finite number of radians in (0, pi)");
  }
  if (!Number.isFinite(input.screenHeight) || input.screenHeight <= 0) {
    throw new Error("screenHeight must be a finite number > 0");
  }
  const pixelError = input.pixelError ?? DEFAULT_PIXEL_ERROR;
  if (!Number.isFinite(pixelError) || pixelError <= 0) {
    throw new Error("pixelError must be a finite number > 0");
  }
  const relief = input.relief ?? 0;
  if (!Number.isFinite(relief) || relief < 0) {
    throw new Error("relief must be a finite number >= 0");
  }
}

function chunkIndexAt(face: CubeFaceIndex, lod: number, u: number, v: number): ChunkRequest {
  const tiles = 2 ** lod;
  const x = Math.min(tiles - 1, Math.max(0, Math.floor(((u + 1) / 2) * tiles)));
  const y = Math.min(tiles - 1, Math.max(0, Math.floor(((v + 1) / 2) * tiles)));
  return { face, lod, x, y };
}

function childChunks(node: ChunkRequest): ChunkRequest[] {
  const lod = node.lod + 1;
  const x = node.x * 2;
  const y = node.y * 2;
  return [
    { face: node.face, lod, x, y },
    { face: node.face, lod, x: x + 1, y },
    { face: node.face, lod, x, y: y + 1 },
    { face: node.face, lod, x: x + 1, y: y + 1 },
  ];
}

type EdgeDirection = 0 | 1 | 2 | 3;

function edgeMidpoint(request: ChunkRequest, direction: EdgeDirection): Vec3 {
  const { u0, u1, v0, v1 } = chunkPatch(request);
  const u = (u0 + u1) / 2;
  const v = (v0 + v1) / 2;
  switch (direction) {
    case 0:
      return cubeFacePoint(request.face, u0, v);
    case 1:
      return cubeFacePoint(request.face, u1, v);
    case 2:
      return cubeFacePoint(request.face, u, v0);
    case 3:
      return cubeFacePoint(request.face, u, v1);
    default: {
      const unknown: never = direction;
      throw new Error(`Unknown edge direction ${String(unknown)}`);
    }
  }
}

/**
 * Same-LOD neighbor across one edge, including the neighbor on the adjacent
 * cube face. The step off the shared edge is a fraction of the tile so a
 * fine LOD does not skip a whole chunk.
 */
export function adjacentChunk(request: ChunkRequest, direction: EdgeDirection): ChunkRequest {
  const tiles = 2 ** request.lod;
  if (direction === 0 && request.x > 0) return { ...request, x: request.x - 1 };
  if (direction === 1 && request.x + 1 < tiles) return { ...request, x: request.x + 1 };
  if (direction === 2 && request.y > 0) return { ...request, y: request.y - 1 };
  if (direction === 3 && request.y + 1 < tiles) return { ...request, y: request.y + 1 };

  const mid = edgeMidpoint(request, direction);
  const span = 2 / tiles;
  // Pull off this face's constant axis. At a shared edge two coordinates are
  // ±1, so the source face has to come from the request, not from which
  // component wins a tie.
  const axis = request.face <= 1 ? "x" : request.face <= 3 ? "y" : "z";
  const nudge = span * 0.25;
  const inward = {
    x: mid.x - (axis === "x" ? Math.sign(mid.x) * nudge : 0),
    y: mid.y - (axis === "y" ? Math.sign(mid.y) * nudge : 0),
    z: mid.z - (axis === "z" ? Math.sign(mid.z) * nudge : 0),
  };
  const neighborFace = cubeFaceIndex(inward);
  const uv = cubeFaceUv(neighborFace, inward);
  return chunkIndexAt(neighborFace, request.lod, uv.u, uv.v);
}

function chunkMetric(request: ChunkRequest, radius: number): ChunkMetric {
  const { u0, u1, v0, v1 } = chunkPatch(request);
  const midU = (u0 + u1) / 2;
  const midV = (v0 + v1) / 2;
  const centerDir = spherifyCube(cubeFacePoint(request.face, midU, midV));
  const center = scale(centerDir, radius);
  let geometricRadius = 0;
  const corners: readonly (readonly [number, number])[] = [
    [u0, v0],
    [u0, v1],
    [u1, v0],
    [u1, v1],
  ];
  for (const [u, v] of corners) {
    const corner = scale(spherifyCube(cubeFacePoint(request.face, u, v)), radius);
    geometricRadius = Math.max(geometricRadius, length(sub(corner, center)));
  }
  const step = (u1 - u0) / (CHUNK_GRID_SIZE - 1);
  const d0 = spherifyCube(cubeFacePoint(request.face, u0, midV));
  const d1 = spherifyCube(cubeFacePoint(request.face, Math.min(u0 + step, u1), midV));
  const geometricError = radius * Math.acos(Math.min(1, Math.max(-1, dot(d0, d1))));
  return { center, geometricRadius, geometricError };
}

/**
 * Distance to the mean-sphere patch. Relief is not subtracted here: treating
 * amplitude as a bounding sphere forces every chunk within that radius of the
 * camera to max LOD. Over the patch, the distance is the altitude above the
 * sphere; beside it, the distance is to the patch edge.
 */
function viewingDistance(camera: Vec3, metric: ChunkMetric): number {
  const distToCenter = length(sub(camera, metric.center));
  const mean = distToCenter - metric.geometricRadius;
  if (mean > 0) return mean;
  return Math.max(0, length(camera) - length(metric.center));
}

/**
 * Perspective projection of a world-space length. Distance is clamped so a
 * camera inside the chunk's bounds forces a split instead of dividing by zero.
 */
function projectedPixels(
  geometricError: number,
  distance: number,
  fovY: number,
  screenHeight: number,
): number {
  const denom = Math.max(distance, 1e-3) * 2 * Math.tan(fovY * 0.5);
  return (geometricError * screenHeight) / denom;
}

function cachedMetric(
  request: ChunkRequest,
  input: LodSelectionInput,
  cache: Map<string, ChunkMetric>,
): ChunkMetric {
  const key = chunkKey(request);
  let metric = cache.get(key);
  if (!metric) {
    metric = chunkMetric(request, input.radius);
    cache.set(key, metric);
  }
  return metric;
}

function screenError(
  request: ChunkRequest,
  input: LodSelectionInput,
  cache: Map<string, ChunkMetric>,
): number {
  const metric = cachedMetric(request, input, cache);
  const distance = viewingDistance(input.cameraPosition, metric);
  return projectedPixels(metric.geometricError, distance, input.fovY, input.screenHeight);
}

/**
 * True when the whole mean-sphere patch sits outside the view cone.
 * The cone is the tighter of the field of view and the horizon, plus a
 * small margin so a chunk that only grazes the screen is still split.
 * Leaving those chunks coarse keeps the cover complete without spending
 * the chunk budget on the far side of the planet.
 */
function entirelyOutsideView(
  request: ChunkRequest,
  input: LodSelectionInput,
  cache: Map<string, ChunkMetric>,
): boolean {
  const camera = input.cameraPosition;
  const cameraDistance = length(camera);
  if (cameraDistance <= input.radius) return false;
  const metric = cachedMetric(request, input, cache);
  const toChunk = sub(metric.center, camera);
  const distance = length(toChunk);
  if (distance < 1e-3) return false;
  const towardCenter = scale(camera, -1);
  const cosView = dot(toChunk, towardCenter) / (distance * cameraDistance);
  const viewAngle = Math.acos(Math.min(1, Math.max(-1, cosView)));
  const angular = Math.asin(Math.min(1, metric.geometricRadius / distance));
  const horizon = Math.asin(Math.min(1, input.radius / cameraDistance));
  const limit = Math.min(input.fovY * 0.5, horizon) + 0.05;
  return viewAngle - angular > limit;
}

function enforceLodGap(leaves: ChunkRequest[], maxLod: number): ChunkRequest[] {
  let current = leaves;
  for (let pass = 0; pass <= maxLod; pass++) {
    const present = new Set(current.map((leaf) => chunkKey(leaf)));
    const split = new Set<string>();
    for (const leaf of current) {
      if (leaf.lod === 0) continue;
      for (const direction of [0, 1, 2, 3] as const) {
        const neighbor = adjacentChunk(leaf, direction);
        const covering = findCovering(present, neighbor);
        if (covering && leaf.lod - covering.lod > MAX_LOD_GAP && covering.lod < maxLod) {
          split.add(chunkKey(covering));
        }
      }
    }
    if (split.size === 0) return current;
    const next: ChunkRequest[] = [];
    for (const leaf of current) {
      if (split.has(chunkKey(leaf))) next.push(...childChunks(leaf));
      else next.push(leaf);
    }
    current = next;
  }
  return current;
}

function findCovering(present: Set<string>, cell: ChunkRequest): ChunkRequest | null {
  let lod = cell.lod;
  let x = cell.x;
  let y = cell.y;
  while (lod >= 0) {
    const candidate: ChunkRequest = { face: cell.face, lod, x, y };
    if (present.has(chunkKey(candidate))) return candidate;
    if (lod === 0) break;
    lod -= 1;
    x = Math.floor(x / 2);
    y = Math.floor(y / 2);
  }
  return null;
}

function distanceToChunk(request: ChunkRequest, input: LodSelectionInput): number {
  return viewingDistance(input.cameraPosition, chunkMetric(request, input.radius));
}

interface Candidate {
  node: ChunkRequest;
  error: number;
}

function moreUrgent(a: Candidate, b: Candidate): boolean {
  if (a.error !== b.error) return a.error > b.error;
  const keyA = chunkKey(a.node);
  const keyB = chunkKey(b.node);
  return keyA < keyB;
}

function heapAt(heap: readonly Candidate[], index: number): Candidate {
  const candidate = heap[index];
  if (!candidate) throw new Error("LOD heap is empty");
  return candidate;
}

function siftUp(heap: Candidate[], index: number): void {
  let cursor = index;
  while (cursor > 0) {
    const parent = Math.floor((cursor - 1) / 2);
    const current = heapAt(heap, cursor);
    const parentItem = heapAt(heap, parent);
    if (!moreUrgent(current, parentItem)) break;
    heap[parent] = current;
    heap[cursor] = parentItem;
    cursor = parent;
  }
}

function siftDown(heap: Candidate[], index: number): void {
  let cursor = index;
  for (;;) {
    const left = cursor * 2 + 1;
    const right = left + 1;
    let best = cursor;
    if (left < heap.length && moreUrgent(heapAt(heap, left), heapAt(heap, best))) best = left;
    if (right < heap.length && moreUrgent(heapAt(heap, right), heapAt(heap, best))) best = right;
    if (best === cursor) break;
    const swap = heapAt(heap, best);
    heap[best] = heapAt(heap, cursor);
    heap[cursor] = swap;
    cursor = best;
  }
}

/**
 * Leaves of one quadtree per cube face.
 * The split test is screen-space error: a chunk divides while one grid step
 * projects to more than `pixelError` pixels. The result is a complete cover
 * of the sphere (no overlaps) whose edge neighbors differ by at most one LOD.
 * Order is nearest camera first so a budgeted mesher can refine the foreground.
 */
export function selectChunks(input: LodSelectionInput): ChunkRequest[] {
  assertInput(input);
  const pixelError = input.pixelError ?? DEFAULT_PIXEL_ERROR;
  const maxLod = input.maxLod ?? MAX_CHUNK_LOD;
  const maxChunks = input.maxChunks ?? DEFAULT_MAX_CHUNKS;
  if (!Number.isInteger(maxLod) || maxLod < 0 || maxLod > MAX_CHUNK_LOD) {
    throw new Error(`maxLod must be an integer from 0 to ${MAX_CHUNK_LOD}`);
  }
  if (!Number.isInteger(maxChunks) || maxChunks < CUBE_FACE_COUNT) {
    throw new Error(`maxChunks must be an integer >= ${CUBE_FACE_COUNT}`);
  }

  const cache = new Map<string, ChunkMetric>();
  const heap: Candidate[] = [];
  const push = (node: ChunkRequest): void => {
    heap.push({ node, error: screenError(node, input, cache) });
    siftUp(heap, heap.length - 1);
  };
  const pop = (): Candidate => {
    const top = heapAt(heap, 0);
    const last = heap.pop();
    if (!last) throw new Error("LOD heap is empty");
    if (heap.length > 0) {
      heap[0] = last;
      siftDown(heap, 0);
    }
    return top;
  };

  for (let face = 0; face < CUBE_FACE_COUNT; face++) {
    push({ face: face as CubeFaceIndex, lod: 0, x: 0, y: 0 });
  }

  // Worst screen error first, so a chunk budget is spent under the camera
  // rather than in tree order across the far side of the planet. A chunk
  // that cannot split (it is already outside the view, or at max LOD) is
  // set aside so a coarser error elsewhere does not block the foreground.
  const finished: ChunkRequest[] = [];
  while (heap.length > 0) {
    const top = heapAt(heap, 0);
    if (top.error <= pixelError) break;
    const outside = entirelyOutsideView(top.node, input, cache);
    if (top.node.lod >= maxLod || outside) {
      finished.push(pop().node);
      continue;
    }
    if (heap.length + finished.length + 3 > maxChunks) break;
    pop();
    for (const child of childChunks(top.node)) push(child);
  }

  const leaves = finished.concat(heap.map((candidate) => candidate.node));
  const restricted = enforceLodGap(leaves, maxLod);
  restricted.sort((a, b) => {
    const delta = distanceToChunk(a, input) - distanceToChunk(b, input);
    if (delta !== 0) return delta;
    const keyA = chunkKey(a);
    const keyB = chunkKey(b);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });
  return restricted;
}
