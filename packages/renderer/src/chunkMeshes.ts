import type { ChunkRequest, Vec3 } from "@planet/engine";
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from "three";
import type { Group, Object3D, PerspectiveCamera } from "three";
import type { ChunkAttachment } from "./layers/types";
import { horizonOccluder, isBeyondHorizon, isSphereInFrustum } from "./culling";

/**
 * Generation boundary. The explorer implements this on the main thread today.
 * A worker pool can return a Promise instead; the mesh manager already waits
 * for it, so the scene graph does not need to change.
 */
export interface ChunkMeshPayload {
  request: ChunkRequest;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  /** Planet-centered origin, meters. */
  origin: Vec3;
  boundingRadius: number;
  lit: boolean;
  /** Time spent inside the generator, milliseconds. */
  generateMs: number;
  /**
   * Surface-grid heights, including the skirt copies the terrain builder
   * writes. Water reads the first `gridSize * gridSize` entries.
   */
  seaRelativeHeight?: Float32Array;
  gridSize?: number;
  planetRadius?: number;
  seaLevel?: number;
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
  mesh: Mesh;
  origin: Vec3;
  boundingRadius: number;
  extras: { attachment: ChunkAttachment; object: Object3D }[];
}

/** New meshes per call once the first shell exists. Each chunk is about a millisecond. */
const DEFAULT_BUILDS_PER_FRAME = 32;

function chunkKey(request: ChunkRequest): string {
  return `${request.face}:${request.lod}:${request.x}:${request.y}`;
}

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
  options?: { buildsPerFrame?: number; attachments?: readonly ChunkAttachment[] },
): ChunkMeshManager {
  const buildsPerFrame = options?.buildsPerFrame ?? DEFAULT_BUILDS_PER_FRAME;
  const attachments = options?.attachments ?? [];
  const resident = new Map<string, Resident>();
  const pending = new Set<string>();
  const litMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0,
  });
  const unlitMaterial = new MeshBasicMaterial({ vertexColors: true });
  let generation = 0;
  let cacheKey = "";
  let frame: ChunkMeshFrame | null = null;
  let lastGenerateMs = 0;
  let totalGenerateMs = 0;
  let generated = 0;

  function stats(selection: readonly ChunkRequest[]): ChunkMeshStats {
    let visibleCount = 0;
    let maxLod = 0;
    for (const chunk of selection) maxLod = Math.max(maxLod, chunk.lod);
    for (const entry of resident.values()) {
      if (entry.mesh.visible) visibleCount += 1;
    }
    return {
      chunkCount: resident.size,
      visibleCount,
      maxLod,
      lastGenerateMs,
      averageGenerateMs: generated === 0 ? 0 : totalGenerateMs / generated,
    };
  }

  function disposeMesh(entry: Resident): void {
    for (const extra of entry.extras) {
      extra.object.removeFromParent();
      extra.attachment.dispose(extra.object);
    }
    entry.mesh.removeFromParent();
    entry.mesh.geometry.dispose();
  }

  function clearResidents(): void {
    for (const entry of resident.values()) disposeMesh(entry);
    resident.clear();
    pending.clear();
    generated = 0;
    totalGenerateMs = 0;
    lastGenerateMs = 0;
  }

  function place(entry: Resident): void {
    if (!frame) return;
    const renderX = entry.origin.x - frame.cameraWorld.x;
    const renderY = entry.origin.y - frame.cameraWorld.y;
    const renderZ = entry.origin.z - frame.cameraWorld.z;
    entry.mesh.position.set(renderX, renderY, renderZ);
    entry.mesh.updateMatrixWorld();
    const inFrustum = isSphereInFrustum(
      frame.camera,
      { x: renderX, y: renderY, z: renderZ },
      entry.boundingRadius,
    );
    const overHorizon = isBeyondHorizon(
      frame.cameraWorld,
      entry.origin,
      entry.boundingRadius,
      horizonOccluder(frame.planetRadius, frame.relief),
    );
    entry.mesh.visible = inFrustum && !overHorizon;
  }

  function commit(payload: ChunkMeshPayload, key: string, builtGeneration: number): void {
    pending.delete(key);
    if (builtGeneration !== generation || !frame) return;
    const wanted = new Set(frame.selection.map((request) => chunkKey(request)));
    if (!wanted.has(key) || resident.has(key)) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(payload.positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(payload.normals, 3));
    geometry.setAttribute("color", new BufferAttribute(payload.colors, 3));
    geometry.setIndex(new BufferAttribute(payload.indices, 1));
    const mesh = new Mesh(geometry, payload.lit ? litMaterial : unlitMaterial);
    mesh.name = `chunk:${key}`;
    mesh.frustumCulled = false;
    const extras: Resident["extras"] = [];
    for (const attachment of attachments) {
      const object = attachment.create(payload);
      if (!object) continue;
      mesh.add(object);
      extras.push({ attachment, object });
    }
    parent.add(mesh);
    const entry: Resident = {
      key,
      mesh,
      origin: payload.origin,
      boundingRadius: payload.boundingRadius,
      extras,
    };
    resident.set(key, entry);
    lastGenerateMs = payload.generateMs;
    totalGenerateMs += payload.generateMs;
    generated += 1;
    place(entry);
  }

  return {
    sync(next: ChunkMeshFrame): ChunkMeshStats {
      frame = next;
      if (next.cacheKey !== cacheKey) {
        generation += 1;
        cacheKey = next.cacheKey;
        clearResidents();
      }
      const wanted = new Set(next.selection.map((request) => chunkKey(request)));
      for (const [key, entry] of resident) {
        if (!wanted.has(key)) {
          disposeMesh(entry);
          resident.delete(key);
        }
      }
      const missing = next.selection.filter((request) => {
        const key = chunkKey(request);
        return !resident.has(key) && !pending.has(key);
      });
      const budget = missing.length <= 8 ? missing.length : buildsPerFrame;
      const builtGeneration = generation;
      for (const request of missing.slice(0, budget)) {
        const key = chunkKey(request);
        pending.add(key);
        const result = source.buildChunk(request);
        if (isPromise(result)) {
          void result.then(
            (payload) => commit(payload, key, builtGeneration),
            () => {
              pending.delete(key);
            },
          );
        } else {
          commit(result, key, builtGeneration);
        }
      }
      for (const entry of resident.values()) place(entry);
      return stats(next.selection);
    },
    dispose(): void {
      generation += 1;
      clearResidents();
      litMaterial.dispose();
      unlitMaterial.dispose();
      frame = null;
    },
  };
}
