import { BackSide, FrontSide, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from "three";
import type { Group } from "three";
import { cloudShellRadius } from "../lighting";
import type { PlanetLayer, PlanetRenderState } from "./types";

const CLOUD_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const CLOUD_FRAGMENT = /* glsl */ `
  uniform vec3 uCenter;
  uniform vec3 uSun;
  uniform float uTime;
  uniform float uCoverage;
  uniform float uDensity;
  uniform float uRadius;
  varying vec3 vWorld;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }

  float fbm(vec3 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      sum += valueNoise(p) * amp;
      p = p * 2.02 + vec3(1.7, 9.2, 2.4);
      amp *= 0.5;
    }
    return sum;
  }

  vec3 toSrgb(vec3 c) {
    return pow(max(c, vec3(0.0)), vec3(0.454545));
  }

  void main() {
    vec3 dir = normalize(vWorld - uCenter);
    vec3 samplePos = dir * 3.4 + vec3(uTime * 0.004, uTime * 0.0015, 0.0);
    float n = fbm(samplePos);
    float edge = 1.0 - uCoverage;
    float mask = smoothstep(edge, edge + 0.16, n);
    if (mask <= 0.001 || uDensity <= 0.0) discard;
    float light = 0.18 + 0.82 * max(dot(dir, normalize(uSun)), 0.0);
    float shade = 0.75 + 0.25 * n;
    vec3 color = vec3(0.93, 0.95, 0.98) * light * shade;
    gl_FragColor = vec4(toSrgb(color), mask * uDensity);
  }
`;

export function createCloudLayer(parent: Group): PlanetLayer {
  const geometry = new SphereGeometry(1, 80, 56);
  const center = new Vector3();
  const sun = new Vector3();
  const material = new ShaderMaterial({
    uniforms: {
      uCenter: { value: center },
      uSun: { value: sun },
      uTime: { value: 0 },
      uCoverage: { value: 0.5 },
      uDensity: { value: 0.6 },
      uRadius: { value: 1 },
    },
    vertexShader: CLOUD_VERTEX,
    fragmentShader: CLOUD_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: FrontSide,
    toneMapped: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "clouds";
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  parent.add(mesh);

  return {
    name: "clouds",
    update(state: PlanetRenderState): void {
      const radius = cloudShellRadius(state.params);
      const visible = state.params.cloudDensity > 0 && state.params.cloudCoverage > 0;
      mesh.visible = visible;
      if (!visible) return;
      center.set(-state.cameraWorld.x, -state.cameraWorld.y, -state.cameraWorld.z);
      sun.set(state.sunDirection.x, state.sunDirection.y, state.sunDirection.z);
      const { uniforms } = material;
      const time = uniforms.uTime;
      const coverage = uniforms.uCoverage;
      const density = uniforms.uDensity;
      const radiusUniform = uniforms.uRadius;
      if (time) time.value = state.timeSeconds;
      if (coverage) coverage.value = state.params.cloudCoverage;
      if (density) density.value = state.params.cloudDensity;
      if (radiusUniform) radiusUniform.value = radius;
      mesh.position.copy(center);
      mesh.scale.setScalar(radius);
      const radial = Math.hypot(state.cameraWorld.x, state.cameraWorld.y, state.cameraWorld.z);
      material.side = radial < radius ? BackSide : FrontSide;
    },
    dispose(): void {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
