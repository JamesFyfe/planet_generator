import { isPlanetParamKey } from "@planet/engine";
import { folder, useControls } from "leva";
import { useMemo } from "react";
import { controlsFromRegistry } from "./controls";
import { usePlanetStore } from "./store";

export function ParamsPanel() {
  const setParam = usePlanetStore((state) => state.setParam);

  const schema = useMemo(() => {
    const grouped = controlsFromRegistry();
    const next: Record<string, ReturnType<typeof folder>> = {};
    for (const [groupName, controls] of Object.entries(grouped)) {
      const fields: Record<string, object> = {};
      for (const [key, spec] of Object.entries(controls)) {
        fields[key] = {
          ...spec,
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
  }, [setParam]);

  useControls(schema);
  return null;
}
