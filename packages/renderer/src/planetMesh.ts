import type { PlanetMeshData } from "@planet/engine";
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from "three";

/**
 * Uploads an engine mesh. The lit flag follows the debug channel: terrain is
 * shaded, and data channels stay unlit so the ramp is the color on screen.
 */
export function createPlanetMesh(data: PlanetMeshData): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(data.normals, 3));
  geometry.setAttribute("color", new BufferAttribute(data.colors, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();

  const material = data.lit
    ? new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.86,
        metalness: 0,
      })
    : new MeshBasicMaterial({ vertexColors: true });

  const mesh = new Mesh(geometry, material);
  mesh.name = "planet";
  return mesh;
}

export function disposePlanetMesh(mesh: Mesh): void {
  mesh.geometry.dispose();
  const { material } = mesh;
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose();
  } else {
    material.dispose();
  }
}
