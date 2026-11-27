import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Leva } from "leva";
import { DebugViewSelect } from "./DebugViewSelect";
import { ParamsPanel } from "./ParamsPanel";
import { ParamsReadout } from "./ParamsReadout";
import { PlanetBody } from "./PlanetBody";

// The default number box is 38px, which clips to four digits. Seed goes to
// 1_000_000 and radius to 500_000, so the box has to hold seven digits.
// The panel is a little wider so labels such as "Noise scale" are not cut off.
const panelTheme = {
  sizes: {
    rootWidth: "340px",
    controlWidth: "200px",
    numberInputMinWidth: "76px",
  },
};

export function App() {
  return (
    <>
      <div className="viewport" role="application" aria-label="Planet viewport">
        <Canvas camera={{ position: [0, 0, 3.4], fov: 45, near: 0.01, far: 50 }} dpr={[1, 2]}>
          <color attach="background" args={["#0b1020"]} />
          <ambientLight intensity={0.28} />
          <directionalLight position={[4, 2.5, 5]} intensity={1.55} />
          <directionalLight position={[-4, -1, -3]} intensity={0.35} />
          {/* Fixed tilt so more than one cube face is visible from the default orbit. */}
          <group rotation={[0.45, 0.7, 0]}>
            <PlanetBody />
          </group>
          <OrbitControls enableDamping minDistance={1.4} maxDistance={8} />
        </Canvas>
      </div>
      <Leva theme={panelTheme} titleBar={{ title: "Planet" }} />
      <ParamsPanel />
      <DebugViewSelect />
      <ParamsReadout />
    </>
  );
}
