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
    expect(shader.vertexShader).toContain("vWorldPos");
    expect(shader.fragmentShader).toContain("sampleTriplanar");
    expect(shader.fragmentShader).toContain("smoothstep(0.28, 0.72, slopeAngle)");
    expect(shader.fragmentShader).toContain("uTriplanarMap");
    expect(shader.uniforms.uTriplanarMap).toBe(terrain.uniforms.uTriplanarMap);
    terrain.material.dispose();
    terrain.texture.dispose();
  });
});
