import { PLANET_PARAM_REGISTRY } from "@planet/engine";
import { describe, expect, it } from "vitest";
import { controlsFromRegistry } from "./controls";

describe("controlsFromRegistry", () => {
  it("copies every registry entry into its group", () => {
    const groups = controlsFromRegistry();
    const seen = new Set<string>();
    for (const param of PLANET_PARAM_REGISTRY) {
      expect(seen.has(param.key)).toBe(false);
      seen.add(param.key);
      expect(groups[param.group]?.[param.key]).toEqual({
        value: param.default,
        min: param.min,
        max: param.max,
        step: param.step,
        label: param.label,
      });
    }
    expect(Object.keys(groups)).toEqual([
      "World",
      "Continents",
      "Mountains",
      "Hills",
      "Detail",
      "Warp",
      "Surface",
      "Atmosphere",
      "Motion",
      "Climate",
    ]);
  });
});
