/**
 * Whittaker bins and placeholder palettes. Classification reads this table;
 * do not fork the ranges into the classifier.
 *
 * Temperature and moisture bins are half-open on the top edge, `[min, max)`,
 * except a bin that ends on the axis maximum, which includes that endpoint.
 * Priority 0 rows tile temperature × moisture. Higher priority rows are
 * overrides (beach, rock, alpine, wetland) and do not have to tile the plane.
 */

export const BIOME_TEMPERATURE_MIN = -60;
export const BIOME_TEMPERATURE_MAX = 45;
export const BIOME_MOISTURE_MIN = 0;
export const BIOME_MOISTURE_MAX = 1;

/** Land colder than this is ice. Permafrost (tundra) starts at this edge. */
export const ICE_CAP_TEMPERATURE_MAX = -8;

export interface BiomeDef {
  id: string;
  index: number;
  label: string;
  color: readonly [number, number, number];
}

export const BIOMES = [
  { id: "ocean", index: 0, label: "Ocean", color: [0.04, 0.2, 0.42] },
  { id: "ice_cap", index: 1, label: "Ice cap", color: [0.9, 0.95, 0.98] },
  { id: "tundra", index: 2, label: "Tundra", color: [0.62, 0.68, 0.56] },
  { id: "boreal_forest", index: 3, label: "Boreal forest", color: [0.08, 0.32, 0.22] },
  { id: "temperate_forest", index: 4, label: "Temperate forest", color: [0.16, 0.48, 0.18] },
  { id: "grassland", index: 5, label: "Grassland", color: [0.62, 0.68, 0.26] },
  { id: "savanna", index: 6, label: "Savanna", color: [0.74, 0.62, 0.22] },
  { id: "desert", index: 7, label: "Desert", color: [0.78, 0.64, 0.36] },
  { id: "tropical_rainforest", index: 8, label: "Tropical rainforest", color: [0.04, 0.4, 0.16] },
  { id: "alpine", index: 9, label: "Alpine", color: [0.55, 0.58, 0.62] },
  { id: "wetland", index: 10, label: "Wetland", color: [0.18, 0.42, 0.34] },
  { id: "bare_rock", index: 11, label: "Bare rock", color: [0.48, 0.42, 0.38] },
  { id: "beach", index: 12, label: "Beach", color: [0.86, 0.78, 0.55] },
] as const satisfies readonly BiomeDef[];

export type BiomeId = (typeof BIOMES)[number]["id"];

export const BIOME_COUNT = BIOMES.length;

const BIOME_BY_ID = new Map<BiomeId, (typeof BIOMES)[number]>(
  BIOMES.map((biome) => [biome.id, biome]),
);

export function biomeById(id: BiomeId): (typeof BIOMES)[number] {
  const biome = BIOME_BY_ID.get(id);
  if (!biome) throw new Error(`Unknown biome "${id}"`);
  return biome;
}

export function biomeIndex(id: BiomeId): number {
  return biomeById(id).index;
}

export interface BiomeRule {
  id: BiomeId;
  tempMin: number;
  tempMax: number;
  moistureMin: number;
  moistureMax: number;
  /** Meters above sea level. `"shore"` is the shared shore width. */
  altitudeMin?: number;
  altitudeMax?: number | "shore";
  slopeMin?: number;
  slopeMax?: number;
  /** Material indices. Omit to ignore rock type. */
  materials?: readonly number[];
  /** Higher wins. 0 is the climate grid. */
  priority: number;
}

const FULL_MOISTURE = { moistureMin: BIOME_MOISTURE_MIN, moistureMax: BIOME_MOISTURE_MAX };

/**
 * Climate grid, then overrides. Ice and tundra are temperature rows:
 * altitude reaches them through the lapse rate, not through a latitude test.
 */
export const BIOME_RULES: readonly BiomeRule[] = [
  {
    id: "ice_cap",
    tempMin: BIOME_TEMPERATURE_MIN,
    tempMax: ICE_CAP_TEMPERATURE_MAX,
    ...FULL_MOISTURE,
    priority: 0,
  },
  {
    id: "tundra",
    tempMin: ICE_CAP_TEMPERATURE_MAX,
    tempMax: 2,
    ...FULL_MOISTURE,
    priority: 0,
  },
  { id: "desert", tempMin: 2, tempMax: 10, moistureMin: 0, moistureMax: 0.32, priority: 0 },
  {
    id: "boreal_forest",
    tempMin: 2,
    tempMax: 10,
    moistureMin: 0.32,
    moistureMax: 1,
    priority: 0,
  },
  { id: "desert", tempMin: 10, tempMax: 20, moistureMin: 0, moistureMax: 0.25, priority: 0 },
  { id: "grassland", tempMin: 10, tempMax: 20, moistureMin: 0.25, moistureMax: 0.55, priority: 0 },
  {
    id: "temperate_forest",
    tempMin: 10,
    tempMax: 20,
    moistureMin: 0.55,
    moistureMax: 1,
    priority: 0,
  },
  { id: "desert", tempMin: 20, tempMax: 45, moistureMin: 0, moistureMax: 0.22, priority: 0 },
  { id: "savanna", tempMin: 20, tempMax: 45, moistureMin: 0.22, moistureMax: 0.48, priority: 0 },
  {
    id: "tropical_rainforest",
    tempMin: 20,
    tempMax: 45,
    moistureMin: 0.48,
    moistureMax: 1,
    priority: 0,
  },
  {
    id: "wetland",
    tempMin: 2,
    tempMax: BIOME_TEMPERATURE_MAX,
    moistureMin: 0.78,
    moistureMax: BIOME_MOISTURE_MAX,
    altitudeMin: 0,
    altitudeMax: 220,
    slopeMax: 0.22,
    priority: 20,
  },
  {
    id: "alpine",
    tempMin: ICE_CAP_TEMPERATURE_MAX,
    tempMax: 12,
    ...FULL_MOISTURE,
    altitudeMin: 1800,
    slopeMax: 0.9,
    priority: 25,
  },
  {
    id: "bare_rock",
    tempMin: ICE_CAP_TEMPERATURE_MAX,
    tempMax: BIOME_TEMPERATURE_MAX,
    ...FULL_MOISTURE,
    slopeMin: 0.62,
    priority: 30,
  },
  {
    id: "bare_rock",
    tempMin: ICE_CAP_TEMPERATURE_MAX,
    tempMax: BIOME_TEMPERATURE_MAX,
    ...FULL_MOISTURE,
    materials: [3],
    slopeMin: 0.38,
    priority: 32,
  },
  {
    id: "beach",
    tempMin: -2,
    tempMax: BIOME_TEMPERATURE_MAX,
    ...FULL_MOISTURE,
    altitudeMin: 0,
    altitudeMax: "shore",
    slopeMax: 0.4,
    priority: 40,
  },
];

/** Temperature/moisture test shared by the classifier and the coverage test. */
export function climateBinContains(
  rule: Pick<BiomeRule, "tempMin" | "tempMax" | "moistureMin" | "moistureMax">,
  temperature: number,
  moisture: number,
): boolean {
  return (
    axisContains(temperature, rule.tempMin, rule.tempMax, BIOME_TEMPERATURE_MAX) &&
    axisContains(moisture, rule.moistureMin, rule.moistureMax, BIOME_MOISTURE_MAX)
  );
}

function axisContains(value: number, min: number, max: number, axisMax: number): boolean {
  if (value < min || value > max) return false;
  if (value === max && max < axisMax) return false;
  return true;
}

export function biomePaletteRgba(): Uint8Array {
  const data = new Uint8Array(BIOME_COUNT * 4);
  for (const biome of BIOMES) {
    const offset = biome.index * 4;
    data[offset] = Math.round(biome.color[0] * 255);
    data[offset + 1] = Math.round(biome.color[1] * 255);
    data[offset + 2] = Math.round(biome.color[2] * 255);
    data[offset + 3] = 255;
  }
  return data;
}
