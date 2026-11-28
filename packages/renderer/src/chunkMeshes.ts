import type { ChunkRequest, Vec3 } from "@planet/engine";
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Sphere,
  Vector3,
} from "three";
import type { Frustum, Group, PerspectiveCamera } from "three";
import { chunkCovers, chunkMeshKey, chunksToDisplay } from "./chunkCoverage";
import { cameraFrustum, horizonOccluder, isBeyondHorizon } from "./culling";
import { createTerrainMaterial } from "./terrainMaterial";

/**
 * Generation boundary. The explorer fulfills this from a worker pool.
 * A synchronous source is still accepted so tests can build a mesh inline.
 */
export interface ChunkMeshPayload {
  request: ChunkRequest;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  /** Sea-relative height, meters. One value per vertex. Drives the terrain shader. */
  seaRelativeHeight?: Float32Array;
  /** Slope in radians. One value per vertex. */
  slope?: Float32Array;
  /** Planet-centered origin, meters. */
  origin: Vec3;
  boundingRadius: number;
  lit: boolean;
  /** Time spent inside the generator, milliseconds. */
  generateMs: number;
}

export interface ChunkMeshSource {
  buildChunk(request: ChunkRequest): ChunkMeshPayload | Promise<ChunkMeshPayload>;
}

export interface ChunkMeshFrame {
  selection: readonly ChunkRequest[];
  cameraWorld: Vec3;
  camera: PerspectiveCamera;
  /** Drop cached meshes when params or the debug channel change. */
  cacheKey: string;
  planetRadius: number;
  relief: number;
}

export interface ChunkMeshStats {
  chunkCount: number;
  visibleCount: number;
  maxLod: number;
  lastGenerateMs: number;
  averageGenerateMs: number;
}

export interface ChunkMeshManager {
  sync(frame: ChunkMeshFrame): ChunkMeshStats;
  dispose(): void;
}

interface Resident {
  key: string;
  request: ChunkRequest;
  mesh: Mesh;
  origin: Vec3;
  boundingRadius: number;
}

/**
 * GPU uploads per call. Generation runs off the main thread; this only bounds
 * how many new geometries are created before the browser gets to paint.
 * A parent-to-children swap is four meshes, and the six root faces fit too.
 */
const DEFAULT_BUILDS_PER_FRAME = 8;

/** New worker jobs per call. The selection is closest-first, and the pool reorders that batch by screen error. */
const REQUESTS_PER_FRAME = 64;

function isPromise(
  value: ChunkMeshPayload | Promise<ChunkMeshPayload>,
): value is Promise<ChunkMeshPayload> {
  return typeof (value as Promise<ChunkMeshPayload>).then === "function";
}

/**
 * Adds and removes chunk meshes to match the current selection.
 * Vertex buffers stay chunk-local. Each frame the mesh matrix is
 * `origin - camera`, computed in float64, so the GPU never sees a
 * planet-centered float32 position.
 */
export function createChunkMeshManager(
  parent: Group,
  source: ChunkMeshSource,
  options?: { buildsPerFrame?: number },
): ChunkMeshManager {
  const buildsPerFrame = options?.buildsPerFrame ?? DEFAULT_BUILDS_PER_FRAME;
  const resident = new Map<string, Resident>();
  const ready = new Map<string, ChunkMeshPayload>();
  const pending = new Set<string>();
  const placeSphere = new Sphere();
  const placeCenter = new Vector3();
  const litMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0,
  });
  const unlitMaterial = new MeshBasicMaterial({ vertexColors: true });
  const terrain = createTerrainMaterial();
  let generation = 0;
  let cacheKey = "";
  let frame: ChunkMeshFrame | null = null;
  let lastGenerateMs = 0;
  let totalGenerateMs = 0;
  let generated = 0;

  function stats(selection: readonly ChunkRequest[], shown: ReadonlySet<string>): ChunkMeshStats {
    let visibleCount = 0;
    let maxLod = 0;
    for (const chunk of selection) maxLod = Math.max(maxLod, chunk.lod);
    for (const key of shown) {
      if (resident.get(key)?.mesh.visible) visibleCount += 1;
    }
    return {
      chunkCount: shown.size,
      visibleCount,
      maxLod,
      lastGenerateMs,
      averageGenerateMs: generated === 0 ? 0 : totalGenerateMs / generated,
    };
  }

  function disposeMesh(mesh: Mesh): void {
    mesh.removeFromParent();
    mesh.geometry.dispose();
  }

  function clearResidents(): void {
    for (const entry of resident.values()) disposeMesh(entry.mesh);
    resident.clear();
    ready.clear();
    pending.clear();
    generated = 0;
    totalGenerateMs = 0;
    lastGenerateMs = 0;
  }

  function place(entry: Resident, frustum: Frustum): void {
    if (!frame) return;
    const renderX = entry.origin.x - frame.cameraWorld.x;
    const renderY = entry.origin.y - frame.cameraWorld.y;
    const renderZ = entry.origin.z - frame.cameraWorld.z;
    entry.mesh.position.set(renderX, renderY, renderZ);
    entry.mesh.updateMatrixWorld();
    placeCenter.set(renderX, renderY, renderZ);
    placeSphere.center.copy(placeCenter);
    placeSphere.radius = entry.boundingRadius;
    const inFrustum = frustum.intersectsSphere(placeSphere);
    const overHorizon = isBeyondHorizon(
      frame.cameraWorld,
      entry.origin,
      entry.boundingRadius,
      horizonOccluder(frame.planetRadius, frame.relief),
    );
    entry.mesh.visible = inFrustum && !overHorizon;
  }

  function remember(payload: ChunkMeshPayload, key: string, builtGeneration: number): void {
    // A newer planet generation may already be using this key. Leave its
    // pending flag alone; the stale payload is discarded.
    if (builtGeneration !== generation || !frame) return;
    pending.delete(key);
    if (resident.has(key)) return;
    const stillWanted = frame.selection.some((request) => chunkMeshKey(request) === key);
    if (!stillWanted) return;
    ready.set(key, payload);
  }

  function upload(payload: ChunkMeshPayload): void {
    const key = chunkMeshKey(payload.request);
    ready.delete(key);
    if (resident.has(key)) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(payload.positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(payload.normals, 3));
    geometry.setAttribute("color", new BufferAttribute(payload.colors, 3));
    geometry.setIndex(new BufferAttribute(payload.indices, 1));
    const shaded =
      payload.lit && payload.slope !== undefined && payload.seaRelativeHeight !== undefined;
    if (payload.slope) geometry.setAttribute("slope", new BufferAttribute(payload.slope, 1));
    if (payload.seaRelativeHeight) {
      geometry.setAttribute("seaHeight", new BufferAttribute(payload.seaRelativeHeight, 1));
    }
    const mesh = new Mesh(
      geometry,
      shaded ? terrain.material : payload.lit ? litMaterial : unlitMaterial,
    );
    mesh.name = `chunk:${key}`;
    mesh.frustumCulled = false;
    mesh.visible = false;
    parent.add(mesh);
    resident.set(key, {
      key,
      request: payload.request,
      mesh,
      origin: payload.origin,
      boundingRadius: payload.boundingRadius,
    });
    lastGenerateMs = payload.generateMs;
    totalGenerateMs += payload.generateMs;
    generated += 1;
  }

  function residentRequests(): ChunkRequest[] {
    return [...resident.values()].map((entry) => entry.request);
  }

  function availableRequests(): ChunkRequest[] {
    return [...residentRequests(), ...[...ready.values()].map((payload) => payload.request)];
  }

  return {
    sync(next: ChunkMeshFrame): ChunkMeshStats {
      frame = next;
      terrain.uniforms.uRadius.value = next.planetRadius;
      terrain.uniforms.uAmplitude.value = next.relief;
      // Same camera that place() subtracts. The shader adds it back so the
      // grain stays on the planet instead of following the view.
      terrain.uniforms.uCameraWorld.value.set(
        next.cameraWorld.x,
        next.cameraWorld.y,
        next.cameraWorld.z,
      );
      if (next.cacheKey !== cacheKey) {
        generation += 1;
        cacheKey = next.cacheKey;
        clearResidents();
      }
      const builtGeneration = generation;
      let requested = 0;
      for (const request of next.selection) {
        if (requested >= REQUESTS_PER_FRAME) break;
        const key = chunkMeshKey(request);
        if (resident.has(key) || ready.has(key) || pending.has(key)) continue;
        requested += 1;
        pending.add(key);
        const result = source.buildChunk(request);
        if (isPromise(result)) {
          void result.then(
            (payload) => remember(payload, key, builtGeneration),
            () => {
              if (builtGeneration === generation) pending.delete(key);
            },
          );
        } else {
          remember(result, key, builtGeneration);
        }
      }

      // Upload only the chunks the coverage set wants. A parent stays the
      // coverage set until every replacement is ready, so a partial child
      // batch is staged (hidden) across frames and swapped in one call.
      const ideal = chunksToDisplay(next.selection, availableRequests());
      const pendingUploads = ideal.filter((request) => {
        const key = chunkMeshKey(request);
        return !resident.has(key) && ready.has(key);
      });
      for (const request of pendingUploads.slice(0, buildsPerFrame)) {
        const payload = ready.get(chunkMeshKey(request));
        if (payload) upload(payload);
      }

      const draw = chunksToDisplay(next.selection, residentRequests());
      const drawKeys = new Set(draw.map((request) => chunkMeshKey(request)));
      const wanted = new Set(next.selection.map((request) => chunkMeshKey(request)));
      const keep = new Set(drawKeys);
      for (const entry of resident.values()) {
        if (keep.has(entry.key) || !wanted.has(entry.key)) continue;
        const waitingOnParent = draw.some(
          (cover) => chunkCovers(cover, entry.request) && chunkMeshKey(cover) !== entry.key,
        );
        if (waitingOnParent) keep.add(entry.key);
      }

      const frustum = frame ? cameraFrustum(frame.camera) : null;
      for (const [key, entry] of resident) {
        if (!keep.has(key)) {
          disposeMesh(entry.mesh);
          resident.delete(key);
          continue;
        }
        if (!drawKeys.has(key) || !frustum) {
          entry.mesh.visible = false;
          continue;
        }
        place(entry, frustum);
      }
      return stats(next.selection, drawKeys);
    },
    dispose(): void {
      generation += 1;
      clearResidents();
      litMaterial.dispose();
      unlitMaterial.dispose();
      terrain.material.dispose();
      terrain.texture.dispose();
      frame = null;
    },
  };
}
