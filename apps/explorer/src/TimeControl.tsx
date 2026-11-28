import { folder, useControls } from "leva";
import { useMemo } from "react";
import { DEFAULT_TIME_SCALE, MAX_TIME_SCALE, usePlanetStore } from "./store";

/**
 * Time scale is simulation state, not a planet parameter. Putting it in the
 * registry would rebuild chunks and would give the engine a clock.
 */
export function TimeControl() {
  const setTimeScale = usePlanetStore((state) => state.setTimeScale);
  const schema = useMemo(
    () => ({
      Time: folder({
        timeScale: {
          value: DEFAULT_TIME_SCALE,
          min: 0,
          max: MAX_TIME_SCALE,
          step: 10,
          label: "Time scale",
          onChange: (value: number) => {
            setTimeScale(value);
          },
        },
      }),
    }),
    [setTimeScale],
  );
  useControls(schema);
  return null;
}
