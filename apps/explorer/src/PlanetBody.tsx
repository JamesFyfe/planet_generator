import {
  buildPlanetMesh,
  createPlanet,
  type PlanetParams,
  type DebugChannelId,
} from "@planet/engine";
import { createPlanetMesh, disposePlanetMesh } from "@planet/renderer";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePlanetStore } from "./store";

/** Mesh builds are synchronous. Wait until a slider drag pauses so they don't stack. */
const MESH_REBUILD_DELAY_MS = 80;

export function PlanetBody() {
  const params = usePlanetStore((state) => state.params);
  const debugChannel = usePlanetStore((state) => state.debugChannel);
  const [display, setDisplay] = useState<{ params: PlanetParams; debugChannel: DebugChannelId }>({
    params,
    debugChannel,
  });

  useEffect(() => {
    if (display.params === params && display.debugChannel === debugChannel) return;
    const handle = window.setTimeout(() => {
      setDisplay({ params, debugChannel });
    }, MESH_REBUILD_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [params, debugChannel, display.params, display.debugChannel]);

  const mesh = useMemo(
    () => createPlanetMesh(buildPlanetMesh(createPlanet(display.params), display.debugChannel)),
    [display],
  );

  // Strict Mode replays effects and then reuses this memoized mesh. Disposing
  // inside the cleanup would free a mesh that is still displayed, so drop the
  // geometry only after the replay has settled on a different mesh or an unmount.
  const live = useRef({ mesh, mounted: true });

  useEffect(() => {
    const state = live.current;
    state.mounted = true;
    return () => {
      state.mounted = false;
    };
  }, []);

  useEffect(() => {
    const state = live.current;
    state.mesh = mesh;
    const snapshot = mesh;
    return () => {
      queueMicrotask(() => {
        if (!state.mounted || state.mesh !== snapshot) {
          disposePlanetMesh(snapshot);
        }
      });
    };
  }, [mesh]);

  return <primitive object={mesh} />;
}
