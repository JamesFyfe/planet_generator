/**
 * Shore width shared by the debug coloring and the beach biome.
 * The smaller of a radius fraction and a slice of the relief: a fixed meter
 * beach disappears from orbit, and a large fraction of the amplitude turns
 * the lowlands into beach. The terrain shader repeats this formula.
 */
export function shoreWidthMeters(radius: number, amplitude: number): number {
  return Math.max(Math.min(Math.abs(radius) * 0.005, Math.abs(amplitude) * 0.08), 1);
}
