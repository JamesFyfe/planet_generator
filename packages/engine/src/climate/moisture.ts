/**
 * Moisture advection on a prepared graph.
 * Each pass reads the previous buffer and writes the next, so cell order
 * cannot change the result. Oceans are reset to their evaporation every pass
 * and are the only source. Land inherits the upwind cell, then rains out on
 * a climb (windward) and keeps what is left on a descent (rain shadow).
 */

/** Meters of climb that rains out most of the arriving moisture. */
const RAIN_CLIMB_M = 900;

/** Fraction of moisture lost per land cell even on flat ground, so a long fetch dries out. */
const TRAVEL_LOSS = 0.035;

export interface AdvectCell {
  ocean: boolean;
  /** Sea-relative meters. */
  height: number;
  /** Cell the wind arrives from, or -1 when this cell has no upwind neighbor. */
  upwind: number;
  /** Ocean source in 0–1, already scaled by the global moisture slider. */
  evaporation: number;
}

export interface AdvectResult {
  moisture: Float32Array;
  /** Fraction of the arriving column dropped on the last pass. */
  rainfall: Float32Array;
}

export function advectMoisture(
  cells: readonly AdvectCell[],
  windStrength: number,
  passes: number,
): AdvectResult {
  const count = cells.length;
  const steps = Math.max(0, Math.floor(passes));
  let previous = new Float32Array(count);
  let next = new Float32Array(count);
  const rainfall = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    const cell = cells[index];
    previous[index] = cell?.ocean ? cell.evaporation : 0;
  }
  const transport = clamp01(windStrength);
  const orographic = Math.min(Math.max(windStrength, 0), 2);

  for (let pass = 0; pass < steps; pass++) {
    for (let index = 0; index < count; index++) {
      const cell = cells[index];
      if (!cell) continue;
      if (cell.ocean || cell.upwind < 0) {
        next[index] = cell.ocean ? cell.evaporation : 0;
        rainfall[index] = 0;
        continue;
      }
      const incoming = (previous[cell.upwind] ?? 0) * transport;
      const traveled = incoming * (1 - TRAVEL_LOSS * transport);
      const climb = cell.height - (cells[cell.upwind]?.height ?? cell.height);
      const dropped =
        climb > 0
          ? traveled * Math.min(climb / RAIN_CLIMB_M, 0.9) * orographic
          : traveled * 0.012 * orographic;
      const kept = Math.max(0, traveled - dropped);
      next[index] = kept;
      rainfall[index] = dropped;
    }
    const swap = previous;
    previous = next;
    next = swap;
  }

  return { moisture: previous, rainfall };
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
