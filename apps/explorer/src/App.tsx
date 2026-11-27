import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Leva } from "leva";
import { ParamsPanel } from "./ParamsPanel";
import { ParamsReadout } from "./ParamsReadout";
import { PlaceholderBody } from "./PlaceholderBody";

export function App() {
  return (
    <>
      <div className="viewport" role="application" aria-label="Planet viewport">
        <Canvas camera={{ position: [0, 0, 3.2], fov: 45 }} dpr={[1, 2]}>
          <color attach="background" args={["#0b1020"]} />
          <ambientLight intensity={0.35} />
          <directionalLight position={[4, 3, 5]} intensity={1.25} />
          <PlaceholderBody />
          <OrbitControls enableDamping />
        </Canvas>
      </div>
      <Leva titleBar={{ title: "Planet" }} />
      <ParamsPanel />
      <ParamsReadout />
    </>
  );
}
