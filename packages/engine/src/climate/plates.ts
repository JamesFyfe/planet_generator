import type { Vec3 } from "../noise/domainWarp";
import type { PlanetParams } from "../params";
import type { PlateSample } from "./material";

/**
 * Plate and crust sample the climate bake reads.
 *
 * The tectonics bake is the owner of motion, boundary class, and hotspots.
 * It is not on this branch: crust falls back to the continent mask (inland
 * continental, ocean-side oceanic) and boundary and volcanic stay clear.
 * `PlateSample` is the shape a plate bake should fill; material classification
 * does not care which producer wrote it.
 */
export function samplePlate(_params: PlanetParams, _direction: Vec3, mask: number): PlateSample {
  return {
    crust: mask >= 0.5 ? 1 : 0,
    boundary: 0,
    volcanic: 0,
  };
}
