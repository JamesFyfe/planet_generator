import { PLANET_PARAM_REGISTRY } from "@planet/engine";

export interface NumberControlSpec {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
}

/** Grouped leva inputs derived from the engine registry. Keys are param keys. */
export function controlsFromRegistry(): Record<string, Record<string, NumberControlSpec>> {
  const groups: Record<string, Record<string, NumberControlSpec>> = {};
  for (const param of PLANET_PARAM_REGISTRY) {
    const group = groups[param.group] ?? {};
    group[param.key] = {
      value: param.default,
      min: param.min,
      max: param.max,
      step: param.step,
      label: param.label,
    };
    groups[param.group] = group;
  }
  return groups;
}
