import { Canvas } from "@react-three/fiber";
import { Leva } from "leva";
import { useRef } from "react";
import { DebugViewSelect } from "./DebugViewSelect";
import { ParamsPanel } from "./ParamsPanel";
import { ParamsReadout } from "./ParamsReadout";
import { PlanetScene } from "./PlanetScene";
import { TimeControl } from "./TimeControl";

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
  const statsRef = useRef<HTMLPreElement>(null);
  return (
    <>
      <div className="viewport" role="application" aria-label="Planet viewport">
        <Canvas camera={{ position: [0, 0, 0], fov: 45, near: 1, far: 1_000_000 }} dpr={[1, 2]}>
          <color attach="background" args={["#000000"]} />
          <PlanetScene statsRef={statsRef} />
        </Canvas>
      </div>
      <Leva theme={panelTheme} titleBar={{ title: "Planet" }} />
      <ParamsPanel />
      <TimeControl />
      <DebugViewSelect />
      <div className="chunk-stats">
        <pre ref={statsRef} data-testid="chunk-stats" />
        <p>Drag to look. Scroll to descend.</p>
      </div>
      <ParamsReadout />
    </>
  );
}
