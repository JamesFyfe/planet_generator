import { usePlanetStore } from "./store";

export function ParamsReadout() {
  const params = usePlanetStore((state) => state.params);
  const debugChannel = usePlanetStore((state) => state.debugChannel);
  const timeScale = usePlanetStore((state) => state.timeScale);
  return (
    <p className="params-readout" data-testid="params-readout">
      <strong>Planet</strong>
      <br />
      seed <span data-testid="value-seed">{params.seed}</span>
      <br />
      radius <span data-testid="value-radius">{params.radius}</span> m
      <br />
      noise scale <span data-testid="value-noise-scale">{params.noiseScale}</span>
      <br />
      octaves <span data-testid="value-octaves">{params.octaves}</span>
      <br />
      amplitude <span data-testid="value-amplitude">{params.amplitude}</span> m
      <br />
      sea level <span data-testid="value-sea-level">{params.seaLevel}</span> m
      <br />
      atmosphere <span data-testid="value-atmosphere">{params.atmosphereDensity}</span>
      <br />
      tilt <span data-testid="value-tilt">{params.axialTilt}</span>°
      <br />
      time scale <span data-testid="value-time-scale">{timeScale}</span>
      <br />
      view <span data-testid="value-debug-view">{debugChannel}</span>
    </p>
  );
}
