import { usePlanetStore } from "./store";

export function ParamsReadout() {
  const params = usePlanetStore((state) => state.params);
  const debugChannel = usePlanetStore((state) => state.debugChannel);
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
      plates <span data-testid="value-plate-count">{params.plateCount}</span>
      <br />
      continents <span data-testid="value-continental-fraction">{params.continentalFraction}</span>
      <br />
      activity <span data-testid="value-tectonic-activity">{params.tectonicActivity}</span>
      <br />
      mountains <span data-testid="value-mountain-height">{params.mountainHeight}</span> m
      <br />
      rifts <span data-testid="value-rift-depth">{params.riftDepth}</span> m
      <br />
      warp <span data-testid="value-boundary-warp">{params.boundaryWarp}</span>
      <br />
      hotspots <span data-testid="value-hotspot-count">{params.hotspotCount}</span>
      <br />
      view <span data-testid="value-debug-view">{debugChannel}</span>
    </p>
  );
}
