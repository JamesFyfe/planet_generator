import {
  MATERIAL_BASALT,
  MATERIAL_GRANITE,
  MATERIAL_SEDIMENTARY,
  MATERIAL_VOLCANIC,
} from "../data/materials";

/** Plate boundary classes the material field understands. */
export const BOUNDARY_NONE = 0;
export const BOUNDARY_CONVERGENT = 1;
export const BOUNDARY_DIVERGENT = 2;
export const BOUNDARY_TRANSFORM = 3;

export interface PlateSample {
  /** 0 oceanic crust, 1 continental crust. */
  crust: number;
  /** {@link BOUNDARY_NONE} through {@link BOUNDARY_TRANSFORM}. */
  boundary: number;
  /** 0–1 hotspot, rift, or arc intensity. */
  volcanic: number;
}

export interface MaterialInput extends PlateSample {
  /** Radians, angle between the normal and the radial direction. */
  slope: number;
  /** Meters. Negative is below sea level. */
  seaRelativeHeight: number;
}

/**
 * Rock type from crust and plate boundaries.
 * Oceanic crust is basalt. Continental lowlands collect sediment. Continental
 * highs stay granite. Volcanic rock wins where the plate field is hot, on a
 * continental rift, or on a convergent arc.
 */
export function materialIndexFromPlate(input: MaterialInput): number {
  const volcanic =
    input.volcanic >= 0.55 ||
    (input.boundary === BOUNDARY_DIVERGENT && input.crust >= 0.5) ||
    (input.boundary === BOUNDARY_CONVERGENT && input.volcanic >= 0.35);
  if (volcanic) return MATERIAL_VOLCANIC;
  if (input.crust < 0.5) return MATERIAL_BASALT;
  if (input.slope < 0.35 && input.seaRelativeHeight < 1400) return MATERIAL_SEDIMENTARY;
  return MATERIAL_GRANITE;
}
