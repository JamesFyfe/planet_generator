import { describe, expect, it } from "vitest";
import { ShaderLib } from "three";
import {
  applyTerrainShader,
  createTerrainMaterial,
  type TerrainShaderSource,
} from "./terrainMaterial";

describe("terrain material", () => {
  it("colors by slope in the shader and samples a triplanar map", () => {
    const terrain = createTerrainMaterial();
    const shader: TerrainShaderSource = {
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
      uniforms: {},
    };
    applyTerrainShader(shader, terrain.uniforms);
    expect(shader.vertexShader).toContain("attribute float slope");
    expect(shader.vertexShader).toContain("attribute float seaHeight");
    expect(shader.vertexShader).toContain("attribute float biomeId");
    expect(shader.vertexShader).toContain("attribute float materialId");
    expect(shader.fragmentShader).toContain("paletteLookup");
    expect(shader.fragmentShader).toContain("uBiomePalette");
    expect(shader.vertexShader).toContain("uniform vec3 uCameraWorld");
    expect(shader.vertexShader).toContain(
      "vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz + uCameraWorld;",
    );
    expect(shader.fragmentShader).toContain("sampleTriplanar");
    expect(shader.fragmentShader).toContain("smoothstep(0.28, 0.72, slopeAngle)");
    expect(shader.fragmentShader).toContain("uTriplanarMap");
    expect(shader.uniforms.uTriplanarMap).toBe(terrain.uniforms.uTriplanarMap);
    expect(shader.uniforms.uCameraWorld).toBe(terrain.uniforms.uCameraWorld);
    terrain.material.dispose();
    terrain.texture.dispose();
    terrain.biomeTexture.dispose();
    terrain.materialTexture.dispose();
  });
});
