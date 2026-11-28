import type { Vec3 } from "@planet/engine";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";
import type { Object3D } from "three";
import type { ChunkMeshPayload } from "../chunkMeshes";
import { directSunTransmittance } from "../lighting";
import type { ChunkAttachment } from "./types";
import type { PlanetRenderState } from "./types";

export interface WaterBuildInput {
  positions: Float32Array;
  seaRelativeHeight: Float32Array;
  origin: Vec3;
  gridSize: number;
  planetRadius: number;
  seaLevel: number;
}

export interface WaterGeometryData {
  positions: Float32Array;
  depth: Float32Array;
  direction: Float32Array;
  indices: Uint32Array;
}

interface WorkingVertex {
  x: number;
  y: number;
  z: number;
  depth: number;
  dx: number;
  dy: number;
  dz: number;
}

/**
 * Sea-level patch in the chunk's local frame.
 * Vertices are `seaPoint - origin`, the same origin the terrain mesh uses,
 * so the shoreline stays in float32 range when the camera is nearby.
 * Returns null when the patch is entirely above sea level.
 */
export function buildWaterGeometry(input: WaterBuildInput): WaterGeometryData | null {
  const { gridSize, origin, planetRadius, seaLevel } = input;
  if (!Number.isInteger(gridSize) || gridSize < 2) return null;
  const seaRadius = planetRadius + seaLevel;
  if (!(seaRadius > 1)) return null;
  const surfaceCount = gridSize * gridSize;
  if (input.positions.length < surfaceCount * 3) return null;
  if (input.seaRelativeHeight.length < surfaceCount) return null;

  const surface: WorkingVertex[] = new Array(surfaceCount);
  let maxDepth = -Infinity;
  for (let index = 0; index < surfaceCount; index++) {
    const offset = index * 3;
    const worldX = origin.x + (input.positions[offset] ?? 0);
    const worldY = origin.y + (input.positions[offset + 1] ?? 0);
    const worldZ = origin.z + (input.positions[offset + 2] ?? 0);
    const radial = Math.hypot(worldX, worldY, worldZ);
    if (!(radial > 0)) return null;
    const dx = worldX / radial;
    const dy = worldY / radial;
    const dz = worldZ / radial;
    const depth = -(input.seaRelativeHeight[index] ?? 0);
    maxDepth = Math.max(maxDepth, depth);
    surface[index] = {
      x: dx * seaRadius - origin.x,
      y: dy * seaRadius - origin.y,
      z: dz * seaRadius - origin.z,
      depth,
      dx,
      dy,
      dz,
    };
  }
  // Entirely dry. A negative depth is above sea level.
  if (!(maxDepth > 0)) return null;

  const wetQuad = (a: number, b: number, c: number, d: number) => {
    const da = surface[a]?.depth ?? 0;
    const db = surface[b]?.depth ?? 0;
    const dc = surface[c]?.depth ?? 0;
    const dd = surface[d]?.depth ?? 0;
    return da > 0 || db > 0 || dc > 0 || dd > 0;
  };

  const used = new Array<number>(surfaceCount).fill(-1);
  const vertices: WorkingVertex[] = [];
  const indices: number[] = [];

  const useVertex = (index: number): number => {
    const existing = used[index] ?? -1;
    if (existing >= 0) return existing;
    const vertex = surface[index];
    if (!vertex) return 0;
    const id = vertices.length;
    vertices.push(vertex);
    used[index] = id;
    return id;
  };

  for (let j = 0; j < gridSize - 1; j++) {
    for (let i = 0; i < gridSize - 1; i++) {
      const a = j * gridSize + i;
      const b = a + 1;
      const c = a + gridSize;
      const d = c + 1;
      if (!wetQuad(a, b, c, d)) continue;
      const ia = useVertex(a);
      const ib = useVertex(b);
      const ic = useVertex(c);
      const id = useVertex(d);
      indices.push(ia, ib, id, ia, id, ic);
    }
  }
  if (indices.length === 0) return null;

  // No skirts. Equal-LOD edges already meet on the sea sphere. A skirt
  // sized from the whole chunk edge is hundreds of meters tall, and on a
  // transparent surface that wall reads as a grid. A one-cell T-junction
  // gap is a fraction of a meter at the LODs the camera actually draws.

  const positions = new Float32Array(vertices.length * 3);
  const depth = new Float32Array(vertices.length);
  const direction = new Float32Array(vertices.length * 3);
  for (let index = 0; index < vertices.length; index++) {
    const vertex = vertices[index];
    if (!vertex) continue;
    const offset = index * 3;
    positions[offset] = vertex.x;
    positions[offset + 1] = vertex.y;
    positions[offset + 2] = vertex.z;
    depth[index] = vertex.depth;
    direction[offset] = vertex.dx;
    direction[offset + 1] = vertex.dy;
    direction[offset + 2] = vertex.dz;
  }
  return { positions, depth, direction, indices: new Uint32Array(indices) };
}

const WATER_VERTEX = /* glsl */ `
  attribute float aDepth;
  attribute vec3 aDir;
  varying float vDepth;
  varying vec3 vDir;
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vDepth = aDepth;
    vDir = aDir;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WATER_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uWave;
  uniform float uShore;
  uniform vec3 uSun;
  uniform vec3 uSunColor;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  varying float vDepth;
  varying vec3 vDir;
  varying vec3 vWorld;

  vec3 toSrgb(vec3 c) {
    return pow(max(c, vec3(0.0)), vec3(0.454545));
  }

  void main() {
    if (vDepth <= 0.0) discard;
    vec3 dir = normalize(vDir);
    float shore = smoothstep(0.0, uShore, vDepth);
    float deep = 1.0 - exp(-vDepth / 16.0);
    vec3 water = mix(uShallow, uDeep, deep);
    // Deep water hides the terrain mesh. Leaving it translucent prints the
    // chunk-edge lighting seams through the ocean as a grid.
    float alpha = shore * mix(0.22, 0.97, deep);

    float k = uWave;
    float wx = sin(dir.x * k + uTime * 1.15) * cos(dir.z * k * 0.8 - uTime * 0.72);
    float wy = cos(dir.y * k * 1.05 + dir.x * k * 0.45 + uTime * 0.95);
    // ~30 m waves are a fraction of a pixel from orbit. The sine then
    // aliases into rings. Drop the normal once one wave spans a pixel.
    float span = length(fwidth(dir)) * k;
    float detail = exp(-span * span);
    vec3 pole = abs(dir.y) > 0.92 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 tangent = normalize(cross(pole, dir));
    vec3 bitangent = cross(dir, tangent);
    vec3 normal = normalize(dir + (tangent * wx + bitangent * wy) * 0.14 * detail);
    if (!gl_FrontFacing) normal = -normal;

    vec3 viewDir = normalize(cameraPosition - vWorld);
    float facing = max(dot(normal, viewDir), 0.0);
    float fresnel = pow(1.0 - facing, 3.0);
    alpha = mix(alpha, min(alpha + 0.35, 1.0), fresnel);
    vec3 sun = normalize(uSun);
    vec3 halfDir = normalize(viewDir + sun);
    float spec = pow(max(dot(normal, halfDir), 0.0), 96.0) * shore;
    float lambert = 0.12 + 0.88 * max(dot(normal, sun), 0.0);
    vec3 color = water * lambert + uSunColor * spec * 0.85;
    gl_FragColor = vec4(toSrgb(color), alpha);
  }
`;

export interface WaterLayer {
  readonly attachment: ChunkAttachment;
  update(state: PlanetRenderState): void;
  dispose(): void;
}

/**
 * Ocean as a chunk attachment. Parenting to the terrain mesh reuses the
 * floating origin, so the shore does not shimmer as the camera moves.
 */
export function createWaterLayer(): WaterLayer {
  const sun = new Vector3(1, 0, 0);
  const sunColor = new Color(1, 1, 1);
  const material = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWave: { value: 9_000 },
      uShore: { value: 6 },
      uSun: { value: sun },
      uSunColor: { value: sunColor },
      uShallow: { value: new Color(0.22, 0.72, 0.7) },
      uDeep: { value: new Color(0.015, 0.09, 0.22) },
    },
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });

  const attachment: ChunkAttachment = {
    name: "water",
    create(payload: ChunkMeshPayload): Object3D | null {
      if (
        payload.seaRelativeHeight === undefined ||
        payload.gridSize === undefined ||
        payload.planetRadius === undefined ||
        payload.seaLevel === undefined
      ) {
        return null;
      }
      const built = buildWaterGeometry({
        positions: payload.positions,
        seaRelativeHeight: payload.seaRelativeHeight,
        origin: payload.origin,
        gridSize: payload.gridSize,
        planetRadius: payload.planetRadius,
        seaLevel: payload.seaLevel,
      });
      if (!built) return null;
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(built.positions, 3));
      geometry.setAttribute("aDepth", new BufferAttribute(built.depth, 1));
      geometry.setAttribute("aDir", new BufferAttribute(built.direction, 3));
      geometry.setIndex(new BufferAttribute(built.indices, 1));
      const mesh = new Mesh(geometry, material);
      mesh.name = "water";
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      return mesh;
    },
    dispose(object: Object3D): void {
      if (object instanceof Mesh) object.geometry.dispose();
    },
  };

  return {
    attachment,
    update(state: PlanetRenderState): void {
      const seaRadius = state.params.radius + state.params.seaLevel;
      const time = material.uniforms.uTime;
      const wave = material.uniforms.uWave;
      if (time) time.value = state.timeSeconds;
      // ~30 m waves on the default planet, and the same angular scale elsewhere.
      if (wave) wave.value = Math.max(seaRadius, 1) * 0.2;
      sun.set(state.sunDirection.x, state.sunDirection.y, state.sunDirection.z);
      const tint = directSunTransmittance(state.params, 0.35);
      sunColor.setRGB(0.35 + 0.65 * tint.r, 0.32 + 0.55 * tint.g, 0.28 + 0.45 * tint.b);
    },
    dispose(): void {
      material.dispose();
    },
  };
}
