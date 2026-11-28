import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearSRGBColorSpace,
  MeshStandardMaterial,
  NearestFilter,
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
uniform sampler2D uBiomePalette;
uniform sampler2D uMaterialPalette;
uniform float uBiomeCount;
uniform float uMaterialCount;
varying float vSeaHeight;
varying float vSlope;
varying float vBiomeId;
varying float vBiomeSecondary;
varying float vBiomeWeight;
varying float vMaterialId;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

vec3 paletteLookup(sampler2D tex, float count, float id) {
  float u = (floor(id + 0.5) + 0.5) / max(count, 1.0);
  return texture2D(tex, vec2(u, 0.5)).rgb;
}

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
  vec3 color;
  if (seaHeight < 0.0) {
    float depth = clamp(-seaHeight / max(uAmplitude, 1.0), 0.0, 1.0);
    color = mix(vec3(0.16, 0.48, 0.62), vec3(0.03, 0.12, 0.28), depth);
  } else {
    vec3 biome = mix(
      paletteLookup(uBiomePalette, uBiomeCount, vBiomeSecondary),
      paletteLookup(uBiomePalette, uBiomeCount, vBiomeId),
      clamp(vBiomeWeight, 0.0, 1.0)
    );
    vec3 rock = paletteLookup(uMaterialPalette, uMaterialCount, vMaterialId);
    color = mix(biome, rock, 0.28);
    color = mix(color, vec3(0.45, 0.40, 0.36), smoothstep(0.28, 0.72, slopeAngle));
    float altitude = smoothstep(0.42, 0.9, clamp(seaHeight / max(uAmplitude, 1.0), 0.0, 1.0));
    color = mix(color, vec3(0.93, 0.95, 0.97), altitude * 0.8);
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
  uBiomePalette: IUniform<DataTexture>;
  uMaterialPalette: IUniform<DataTexture>;
  uBiomeCount: IUniform<number>;
  uMaterialCount: IUniform<number>;
}

export interface TerrainPalettes {
  biomeRgba: Uint8Array;
  biomeCount: number;
  materialRgba: Uint8Array;
  materialCount: number;
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
  shader.uniforms.uBiomePalette = uniforms.uBiomePalette;
  shader.uniforms.uMaterialPalette = uniforms.uMaterialPalette;
  shader.uniforms.uBiomeCount = uniforms.uBiomeCount;
  shader.uniforms.uMaterialCount = uniforms.uMaterialCount;

  shader.vertexShader = mustReplace(
    shader.vertexShader,
    "varying vec3 vViewPosition;",
    `uniform vec3 uCameraWorld;
attribute float seaHeight;
attribute float slope;
attribute float biomeId;
attribute float biomeSecondary;
attribute float biomeWeight;
attribute float materialId;
varying float vSeaHeight;
varying float vSlope;
varying float vBiomeId;
varying float vBiomeSecondary;
varying float vBiomeWeight;
varying float vMaterialId;
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
vBiomeId = biomeId;
vBiomeSecondary = biomeSecondary;
vBiomeWeight = biomeWeight;
vMaterialId = materialId;
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

function paletteTexture(rgba: Uint8Array, count: number): DataTexture {
  const width = Math.max(1, count);
  const bytes = rgba.length >= width * 4 ? rgba : new Uint8Array(width * 4).fill(180);
  const texture = new DataTexture(bytes, width, 1);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createTerrainMaterial(palettes?: TerrainPalettes): {
  material: MeshStandardMaterial;
  uniforms: TerrainReliefUniforms;
  texture: DataTexture;
  biomeTexture: DataTexture;
  materialTexture: DataTexture;
} {
  const texture = createPlaceholderTexture();
  const biomeTexture = paletteTexture(
    palettes?.biomeRgba ?? new Uint8Array(4),
    palettes?.biomeCount ?? 1,
  );
  const materialTexture = paletteTexture(
    palettes?.materialRgba ?? new Uint8Array(4),
    palettes?.materialCount ?? 1,
  );
  const uniforms: TerrainReliefUniforms = {
    uAmplitude: { value: 4_000 },
    uRadius: { value: 50_000 },
    uCameraWorld: { value: new Vector3() },
    uTriplanarMap: { value: texture },
    uBiomePalette: { value: biomeTexture },
    uMaterialPalette: { value: materialTexture },
    uBiomeCount: { value: palettes?.biomeCount ?? 1 },
    uMaterialCount: { value: palettes?.materialCount ?? 1 },
  };
  const material = new MeshStandardMaterial({
    roughness: 0.9,
    metalness: 0,
    vertexColors: false,
  });
  material.customProgramCacheKey = () => "planet-terrain-biome-triplanar-v3";
  cameraByMaterial.set(material, uniforms.uCameraWorld.value);
  material.onBeforeCompile = (shader) => {
    applyTerrainShader(shader, uniforms);
  };
  return { material, uniforms, texture, biomeTexture, materialTexture };
}
