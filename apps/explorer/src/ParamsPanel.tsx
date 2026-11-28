import { PLANET_PARAM_REGISTRY, isPlanetParamKey } from "@planet/engine";
import { folder, useControls } from "leva";
import { controlsFromRegistry } from "./controls";
import { usePlanetStore } from "./store";

export function ParamsPanel() {
  const setParam = usePlanetStore((state) => state.setParam);
  const panelEpoch = usePlanetStore((state) => state.panelEpoch);

  useControls(() => {
    const current = usePlanetStore.getState().params;
    const grouped = controlsFromRegistry();
    const next: Record<string, ReturnType<typeof folder>> = {};
    for (const [groupName, controls] of Object.entries(grouped)) {
      const fields: Record<string, object> = {};
      for (const [key, spec] of Object.entries(controls)) {
        const meta = PLANET_PARAM_REGISTRY.find((param) => param.key === key);
        fields[key] = {
          ...spec,
          value: meta ? current[meta.key] : spec.value,
          onChange: (value: number) => {
            if (isPlanetParamKey(key)) setParam(key, value);
          },
        };
      }
      // folder() only infers a schema from an object literal. These fields are
      // built from the registry, so the cast is the handoff into leva.
      next[groupName] = folder(fields as Parameters<typeof folder>[0]);
    }
    return next;
    // panelEpoch is leva's dependency, not a React hook dependency. Changing it
    // rebuilds the controls after a preset or a JSON load.
  }, [panelEpoch]);
  return null;
}
