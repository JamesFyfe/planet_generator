/**
 * Rock colors. The classifier picks an id from plate and crust inputs;
 * these rows are only the debug and shader palette.
 */

export interface MaterialDef {
  id: string;
  index: number;
  label: string;
  color: readonly [number, number, number];
}

export const MATERIALS = [
  { id: "basalt", index: 0, label: "Basalt", color: [0.22, 0.24, 0.3] },
  { id: "granite", index: 1, label: "Granite", color: [0.64, 0.56, 0.52] },
  { id: "sedimentary", index: 2, label: "Sedimentary", color: [0.74, 0.64, 0.42] },
  { id: "volcanic", index: 3, label: "Volcanic", color: [0.38, 0.16, 0.12] },
] as const satisfies readonly MaterialDef[];

export type MaterialId = (typeof MATERIALS)[number]["id"];

export const MATERIAL_COUNT = MATERIALS.length;

export const MATERIAL_BASALT = 0;
export const MATERIAL_GRANITE = 1;
export const MATERIAL_SEDIMENTARY = 2;
export const MATERIAL_VOLCANIC = 3;

const MATERIAL_BY_INDEX = new Map<number, (typeof MATERIALS)[number]>(
  MATERIALS.map((material) => [material.index, material]),
);

export function materialByIndex(index: number): (typeof MATERIALS)[number] {
  const material = MATERIAL_BY_INDEX.get(index);
  if (!material) throw new Error(`Unknown material ${index}`);
  return material;
}

export function materialPaletteRgba(): Uint8Array {
  const data = new Uint8Array(MATERIAL_COUNT * 4);
  for (const material of MATERIALS) {
    const offset = material.index * 4;
    data[offset] = Math.round(material.color[0] * 255);
    data[offset + 1] = Math.round(material.color[1] * 255);
    data[offset + 2] = Math.round(material.color[2] * 255);
    data[offset + 3] = 255;
  }
  return data;
}
