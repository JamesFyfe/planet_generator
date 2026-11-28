import {
  BackSide,
  CustomBlending,
  FrontSide,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import type { Group } from "three";
import {
  atmosphereRadii,
  cameraInsideAtmosphere,
  isAtmosphereEnabled,
  scatteringCoefficients,
} from "../lighting";
import type { PlanetLayer, PlanetRenderState } from "./types";

const VIEW_STEPS = 32;

/**
 * Single-scattering Rayleigh + Mie. The sample start is dithered so a
 * short march does not quantize into bands. The shell is only a raster
 * mask: the ray always starts at the camera, which is what makes the same
 * shader valid from orbit and from inside the atmosphere.
 */
const ATMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 uCenter;
  uniform vec3 uSun;
  uniform vec3 uBetaR;
  uniform float uBetaM;
  uniform float uInner;
  uniform float uOuter;
  uniform float uScale;
  uniform float uMieScale;
  uniform float uExposure;
  varying vec3 vWorld;

  const int VIEW_STEPS = ${VIEW_STEPS};
  const float PI = 3.14159265;
  const float G = 0.76;

  vec2 raySphere(vec3 ro, vec3 rd, vec3 center, float radius) {
    vec3 oc = ro - center;
    float b = dot(oc, rd);
    float disc = b * b - (dot(oc, oc) - radius * radius);
    if (disc < 0.0) return vec2(1e9, -1e9);
    float s = sqrt(disc);
    return vec2(-b - s, -b + s);
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - ro);
    vec2 outer = raySphere(ro, rd, uCenter, uOuter);
    if (outer.y < 0.0) discard;
    float tStart = max(outer.x, 0.0);
    float tEnd = outer.y;
    vec2 inner = raySphere(ro, rd, uCenter, uInner);
    bool hitsGround = inner.x > tStart && inner.x < tEnd;
    if (hitsGround) tEnd = inner.x;
    if (length(ro - uCenter) < uInner && inner.y > 0.0) tStart = max(tStart, inner.y);
    if (tEnd <= tStart + 1.0) discard;

    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float dt = (tEnd - tStart) / float(VIEW_STEPS);
    float t = tStart + dt * dither;
    vec3 sun = normalize(uSun);
    float mu = dot(rd, sun);
    float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    float g2 = G * G;
    float phaseM = (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * G * mu, 1.5));

    vec3 scatter = vec3(0.0);
    vec3 viewOpt = vec3(0.0);
    for (int i = 0; i < VIEW_STEPS; i++) {
      vec3 p = ro + rd * t;
      float height = length(p - uCenter) - uInner;
      float rho = exp(-max(height, 0.0) / uScale);
      float rhoM = exp(-max(height, 0.0) / uMieScale);

      // Chapman air mass. A numerical march of a few steps misses the
      // grazing path and the horizon stays blue. The cap is the spherical
      // maximum, sqrt(π R / 2H). Below the horizon the beam fades out
      // instead of snapping to black.
      vec3 up = normalize(p - uCenter);
      float muSun = dot(up, sun);
      float cap = sqrt(PI * uInner / (2.0 * uScale));
      float mass = muSun > 0.0
        ? min(1.0 / max(muSun, 0.02), cap)
        : mix(cap, 28.0, clamp(-muSun / 0.18, 0.0, 1.0));
      float sunOptR = exp(-max(height, 0.0) / uScale) * uScale * mass;
      float sunOptM = exp(-max(height, 0.0) / uMieScale) * uMieScale * mass;
      vec3 tau = viewOpt + uBetaR * sunOptR + vec3(uBetaM * sunOptM);
      vec3 trans = exp(-clamp(tau, 0.0, 40.0));
      vec3 beta = uBetaR * rho * phaseR + vec3(uBetaM * rhoM * phaseM);
      scatter += trans * beta * dt;
      viewOpt += uBetaR * rho * dt + vec3(uBetaM * rhoM * dt);
      t += dt;
    }

    vec3 transmittance = exp(-clamp(viewOpt, 0.0, 40.0));
    if (!hitsGround && mu > 0.0) {
      float disc = smoothstep(0.9992, 0.9999, mu);
      scatter += vec3(1.0, 0.96, 0.9) * disc * 6.0 * transmittance;
    }
    vec3 color = scatter * uExposure;
    color = color / (color + vec3(1.0));
    color += (dither - 0.5) / 255.0;
    float remaining = clamp((transmittance.r + transmittance.g + transmittance.b) / 3.0, 0.0, 1.0);
    gl_FragColor = vec4(color, 1.0 - remaining);
  }
`;

export function createAtmosphereLayer(parent: Group): PlanetLayer {
  const geometry = new SphereGeometry(1, 128, 96);
  const center = new Vector3();
  const sun = new Vector3();
  const betaR = new Vector3();
  const material = new ShaderMaterial({
    uniforms: {
      uCenter: { value: center },
      uSun: { value: sun },
      uBetaR: { value: betaR },
      uBetaM: { value: 0 },
      uInner: { value: 1 },
      uOuter: { value: 2 },
      uScale: { value: 2000 },
      uMieScale: { value: 500 },
      uExposure: { value: 10 },
    },
    vertexShader: ATMOSPHERE_VERTEX,
    fragmentShader: ATMOSPHERE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: FrontSide,
    toneMapped: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "atmosphere";
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  parent.add(mesh);

  return {
    name: "atmosphere",
    update(state: PlanetRenderState): void {
      const enabled = isAtmosphereEnabled(state.params);
      mesh.visible = enabled;
      if (!enabled) return;
      const radii = atmosphereRadii(state.params);
      center.set(-state.cameraWorld.x, -state.cameraWorld.y, -state.cameraWorld.z);
      sun.set(state.sunDirection.x, state.sunDirection.y, state.sunDirection.z);
      const beta = scatteringCoefficients(state.params);
      betaR.set(beta.rayleigh.x, beta.rayleigh.y, beta.rayleigh.z);
      const { uniforms } = material;
      const betaM = uniforms.uBetaM;
      const inner = uniforms.uInner;
      const outer = uniforms.uOuter;
      const scaleUniform = uniforms.uScale;
      const mieScale = uniforms.uMieScale;
      if (betaM) betaM.value = beta.mie;
      if (inner) inner.value = radii.inner;
      if (outer) outer.value = radii.outer;
      const scale = Math.max(state.params.atmosphereScaleHeight, 1);
      if (scaleUniform) scaleUniform.value = scale;
      if (mieScale) mieScale.value = Math.max(scale * 0.25, 1);
      mesh.position.copy(center);
      mesh.scale.setScalar(radii.outer);
      material.side = cameraInsideAtmosphere(state.cameraWorld, state.params)
        ? BackSide
        : FrontSide;
    },
    dispose(): void {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
