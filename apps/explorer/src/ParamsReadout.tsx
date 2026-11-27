import { usePlanetStore } from "./store";

export function ParamsReadout() {
  const params = usePlanetStore((state) => state.params);
  return (
    <p className="params-readout" data-testid="params-readout">
      <strong>Placeholder</strong>
      <br />
      seed <span data-testid="value-seed">{params.seed}</span>
      <br />
      radius <span data-testid="value-radius">{params.radius}</span> m
      <br />
      noise scale <span data-testid="value-noise-scale">{params.noiseScale}</span>
    </p>
  );
}
