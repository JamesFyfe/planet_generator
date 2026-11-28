import {
  DataTexture,
  LinearFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  Vector3,
  type IUniform,
} from "three";

/**
 * Numbers shared with `terrainColor` in the engine. The renderer may import
 * engine types only, so the shader repeats the palette instead of calling it.
 * Slope rock window is 0.28–0.72 rad. Shore width is
 * max(min(radius * 0.005, amplitude * 0.08), 1).
 */
const FRAGMENT_HOOKS = /* glsl */ `
uniform float uAmplitude;
uniform float uRadius;
uniform sampler2D uTriplanarMap;
varying float vSeaHeight;
varying float vSlope;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

vec3 sampleTriplanar(sampler2D tex, vec3 pos, vec3 normal, float tilesPerMeter) {
  vec3 blend = abs(normal);
  blend = pow(max(blend, vec3(0.0001)), vec3(4.0));
  blend /= blend.x + blend.y + blend.z;
  vec3 xColor = texture2D(tex, pos.yz * tilesPerMeter).rgb;
  vec3 yColor = texture2D(tex, pos.xz * tilesPerMeter).rgb;
  vec3 zColor = texture2D(tex, pos.xy * tilesPerMeter).rgb;
  return xColor * blend.x + yColor * blend.y + zColor * blend.z;
}

vec3 terrainAlbedo(float seaHeight, float slopeAngle, vec3 worldPos, vec3 worldNormal) {
  float shoreWidth = max(min(uRadius * 0.005, uAmplitude * 0.08), 1.0);
  vec3 color;
  if (seaHeight < 0.0) {
    float depth = clamp(-seaHeight / max(uAmplitude, 1.0), 0.0, 1.0);
    color = mix(vec3(0.16, 0.48, 0.62), vec3(0.03, 0.12, 0.28), depth);
  } else if (seaHeight < shoreWidth) {
    color = vec3(0.84, 0.76, 0.52);
  } else {
    float landSpan = max(uAmplitude - shoreWidth, 1.0);
    float t = clamp((seaHeight - shoreWidth) / landSpan, 0.0, 1.0);
    vec3 lowland = mix(vec3(0.22, 0.46, 0.22), vec3(0.40, 0.34, 0.24), clamp(t / 0.45, 0.0, 1.0));
    vec3 highland = mix(vec3(0.40, 0.34, 0.24), vec3(0.93, 0.94, 0.95), clamp((t - 0.45) / 0.55, 0.0, 1.0));
    color = t < 0.45 ? lowland : highland;
    color = mix(color, vec3(0.45, 0.40, 0.36), smoothstep(0.28, 0.72, slopeAngle));
  }
  vec3 grain = sampleTriplanar(uTriplanarMap, worldPos, worldNormal, 1.0 / 90.0);
  vec3 macro = sampleTriplanar(uTriplanarMap, worldPos, worldNormal, 1.0 / 4500.0);
  vec3 tex = macro * 0.65 + grain * 0.35;
  color *= mix(vec3(1.0), tex * 2.0, 0.35);
  return color;
}
`;

export interface TerrainReliefUniforms {
  uAmplitude: IUniform<number>;
  uRadius: IUniform<number>;
  /** Planet-centered camera, meters. Added back onto the camera-relative vertex. */
  uCameraWorld: IUniform<Vector3>;
  uTriplanarMap: IUniform<DataTexture>;
}

export interface TerrainShaderSource {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, IUniform>;
}

function mustReplace(source: string, needle: string, replacement: string, label: string): string {
  if (!source.includes(needle)) {
    throw new Error(`terrain shader is missing ${label}`);
  }
  return source.replace(needle, replacement);
}

/**
 * Patches the standard material so slope and sea height drive the albedo,
 * then multiplies a triplanar placeholder.
 * Chunk vertices are camera-relative meters, which keeps the mesh matrix small.
 * `uCameraWorld` is the same camera that was subtracted, so the sample is the
 * planet-centered point. A shared edge subtracts and adds that one camera
 * from either chunk, and the grain does not slide when the camera moves.
 */
export function applyTerrainShader(
  shader: TerrainShaderSource,
  uniforms: TerrainReliefUniforms,
): void {
  shader.uniforms.uAmplitude = uniforms.uAmplitude;
  shader.uniforms.uRadius = uniforms.uRadius;
  shader.uniforms.uCameraWorld = uniforms.uCameraWorld;
  shader.uniforms.uTriplanarMap = uniforms.uTriplanarMap;

  shader.vertexShader = mustReplace(
    shader.vertexShader,
    "varying vec3 vViewPosition;",
    `uniform vec3 uCameraWorld;
attribute float seaHeight;
attribute float slope;
varying float vSeaHeight;
varying float vSlope;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vViewPosition;`,
    "vertex view position",
  );
  shader.vertexShader = mustReplace(
    shader.vertexShader,
    "#include <begin_vertex>",
    `#include <begin_vertex>
vSeaHeight = seaHeight;
vSlope = slope;
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz + uCameraWorld;
vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
    "begin_vertex",
  );

  shader.fragmentShader = mustReplace(
    shader.fragmentShader,
    "varying vec3 vViewPosition;",
    `${FRAGMENT_HOOKS}
varying vec3 vViewPosition;`,
    "fragment view position",
  );
  shader.fragmentShader = mustReplace(
    shader.fragmentShader,
    "#include <color_fragment>",
    `#include <color_fragment>
diffuseColor.rgb = terrainAlbedo(vSeaHeight, vSlope, vWorldPos, normalize(vWorldNormal));`,
    "color_fragment",
  );
  shader.fragmentShader = mustReplace(
    shader.fragmentShader,
    "#include <roughnessmap_fragment>",
    `#include <roughnessmap_fragment>
roughnessFactor = mix(0.9, 0.72, smoothstep(0.28, 0.72, vSlope));`,
    "roughnessmap_fragment",
  );
}

const cameraByMaterial = new WeakMap<MeshStandardMaterial, Vector3>();

/** Planet-centered camera written into the shared terrain material, meters. */
export function terrainCameraWorld(material: MeshStandardMaterial): Vector3 | undefined {
  return cameraByMaterial.get(material);
}

function placeholderByte(x: number, y: number): number {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  const fine = (n ^ (n >>> 16)) & 255;
  let c = ((x >> 3) * 374761393 + (y >> 3) * 668265263) | 0;
  c = Math.imul(c ^ (c >>> 13), 1274126177);
  const coarse = (c ^ (c >>> 16)) & 255;
  const mixed = (fine * 0.35 + coarse * 0.65) / 255;
  return Math.round((0.35 + mixed * 0.3) * 255);
}

/** Repeatable gray grain. Centered near 0.5 so the shader can scale it around white. */
export function createPlaceholderTexture(): DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = placeholderByte(x, y);
      const offset = (y * size + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function createTerrainMaterial(): {
  material: MeshStandardMaterial;
  uniforms: TerrainReliefUniforms;
  texture: DataTexture;
} {
  const texture = createPlaceholderTexture();
  const uniforms: TerrainReliefUniforms = {
    uAmplitude: { value: 4_000 },
    uRadius: { value: 50_000 },
    uCameraWorld: { value: new Vector3() },
    uTriplanarMap: { value: texture },
  };
  const material = new MeshStandardMaterial({
    roughness: 0.9,
    metalness: 0,
    vertexColors: false,
  });
  material.customProgramCacheKey = () => "planet-terrain-slope-triplanar-v2";
  cameraByMaterial.set(material, uniforms.uCameraWorld.value);
  material.onBeforeCompile = (shader) => {
    applyTerrainShader(shader, uniforms);
  };
  return { material, uniforms, texture };
}
