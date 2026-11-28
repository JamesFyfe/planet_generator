import { BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector3 } from "three";
import type { Group } from "three";
import { rotationAxis } from "../lighting";
import type { PlanetLayer, PlanetRenderState } from "./types";

const STAR_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  void main() {
    // Directions, not positions: a nearby star sphere would fall inside the
    // near plane once the camera is more than a couple of kilometers out.
    vec4 viewDir = viewMatrix * modelMatrix * vec4(normalize(position), 0.0);
    gl_Position = projectionMatrix * viewDir;
    gl_Position.z = gl_Position.w;
    gl_PointSize = aSize;
    vColor = aColor;
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 point = gl_PointCoord * 2.0 - 1.0;
    float dist = dot(point, point);
    if (dist > 1.0) discard;
    float core = smoothstep(1.0, 0.15, dist);
    gl_FragColor = vec4(vColor * core, 1.0);
  }
`;

function hash(index: number): number {
  let x = Math.imul(index + 1, 374761393);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Fixed inertial star field. The group spins with the sun so constellations stay put. */
export function createStarLayer(parent: Group): PlanetLayer {
  const count = 1800;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const radius = 80;
    positions[i * 3] = Math.cos(theta) * ring * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = Math.sin(theta) * ring * radius;
    const bright = hash(i);
    const warm = hash(i + 19);
    const tint = 0.55 + bright * 0.45;
    colors[i * 3] = tint * (0.82 + warm * 0.18);
    colors[i * 3 + 1] = tint * (0.86 + (1 - warm) * 0.1);
    colors[i * 3 + 2] = tint;
    sizes[i] = bright > 0.96 ? 3.4 : bright > 0.8 ? 2.3 : 1.6;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new BufferAttribute(sizes, 1));
  const material = new ShaderMaterial({
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const points = new Points(geometry, material);
  points.name = "stars";
  points.frustumCulled = false;
  points.renderOrder = -20;
  parent.add(points);
  const axis = new Vector3(0, 1, 0);

  return {
    name: "stars",
    update(state: PlanetRenderState): void {
      const tiltAxis = rotationAxis(state.params.axialTilt);
      axis.set(tiltAxis.x, tiltAxis.y, tiltAxis.z);
      points.quaternion.setFromAxisAngle(axis, state.spinAngle);
    },
    dispose(): void {
      points.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
