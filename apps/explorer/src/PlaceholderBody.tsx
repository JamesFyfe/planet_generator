import { usePlanetStore } from "./store";

function colorFromSeed(seed: number): string {
  const hue = Math.abs(Math.trunc(seed)) % 360;
  // three.js Color.setStyle only parses the comma form, not modern hsl().
  return `hsl(${hue}, 42%, 58%)`;
}

export function PlaceholderBody() {
  const seed = usePlanetStore((state) => state.params.seed);
  // Radius is meters on a planet-scale body. This mesh stays at unit size so
  // the placeholder camera has a stable target. Planet-scale vertices arrive
  // with chunk-local positions in a later phase.
  return (
    <mesh>
      <sphereGeometry args={[1, 48, 48]} />
      <meshStandardMaterial color={colorFromSeed(seed)} roughness={0.55} metalness={0.05} />
    </mesh>
  );
}
