import { describe, expect, it } from "vitest";
import { MeshBasicMaterial, MeshStandardMaterial } from "three";
import type { PlanetMeshData } from "@planet/engine";
import { createPlanetMesh, disposePlanetMesh } from "./planetMesh";

function meshData(lit: boolean): PlanetMeshData {
  return {
    positions: new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    colors: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    lit,
  };
}

describe("createPlanetMesh", () => {
  it("uploads positions, normals, colors, and indices", () => {
    const mesh = createPlanetMesh(meshData(true));
    expect(mesh.name).toBe("planet");
    expect(mesh.geometry.getAttribute("position").count).toBe(3);
    expect(mesh.geometry.getAttribute("normal").count).toBe(3);
    expect(mesh.geometry.getAttribute("color").count).toBe(3);
    expect(mesh.geometry.getIndex()?.count).toBe(3);
    expect(mesh.material).toBeInstanceOf(MeshStandardMaterial);
    expect((mesh.material as MeshStandardMaterial).vertexColors).toBe(true);
    disposePlanetMesh(mesh);
  });

  it("uses an unlit material for data channels", () => {
    const mesh = createPlanetMesh(meshData(false));
    expect(mesh.material).toBeInstanceOf(MeshBasicMaterial);
    disposePlanetMesh(mesh);
  });
});
