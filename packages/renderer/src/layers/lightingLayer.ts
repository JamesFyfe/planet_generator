import { AmbientLight, Color, DirectionalLight } from "three";
import type { Group } from "three";
import { cameraInsideAtmosphere, directSunTransmittance, sunUpCosine } from "../lighting";
import type { PlanetLayer, PlanetRenderState } from "./types";

/**
 * Parallel sun. From inside the atmosphere the beam takes the sunset tint;
 * from orbit it stays white so the day side is not globally red.
 */
export function createLightingLayer(parent: Group): PlanetLayer {
  const sun = new DirectionalLight("#fff6e8", 3.4);
  sun.name = "sun";
  sun.target.name = "sun-target";
  const ambient = new AmbientLight("#9eb0c8", 0.045);
  ambient.name = "sky-ambient";
  parent.add(sun);
  parent.add(sun.target);
  parent.add(ambient);
  const color = new Color();

  return {
    name: "lighting",
    update(state: PlanetRenderState): void {
      sun.position.set(state.sunDirection.x, state.sunDirection.y, state.sunDirection.z);
      sun.target.position.set(0, 0, 0);
      const inside = cameraInsideAtmosphere(state.cameraWorld, state.params);
      const tint = inside
        ? directSunTransmittance(state.params, sunUpCosine(state.cameraWorld, state.sunDirection))
        : { r: 1, g: 0.97, b: 0.92 };
      color.setRGB(tint.r, tint.g, tint.b);
      sun.color.copy(color);
      sun.intensity = inside ? 3.6 : 3.3;
      const airless = state.params.atmosphereDensity <= 0;
      ambient.color.set(airless ? "#2a2a2a" : "#8ea2bf");
      ambient.intensity = airless ? 0.03 : 0.05;
    },
    dispose(): void {
      sun.removeFromParent();
      sun.target.removeFromParent();
      ambient.removeFromParent();
      sun.dispose();
    },
  };
}
