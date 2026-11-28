import { createPlanet, selectChunkPlan } from "@planet/engine";
import type { Planet } from "@planet/engine";
import { createChunkMeshManager } from "@planet/renderer";
import type { ChunkMeshManager } from "@planet/renderer";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { DirectionalLight, Group, PerspectiveCamera, Vector3 } from "three";
import { createPlanetChunkSource } from "./chunkSource";
import { formatChunkStats } from "./chunkStats";
import { applyOrbitDrag, spherical, viewUp } from "./orbit";
import { usePlanetStore } from "./store";

const ORBIT_RADIUS_SCALE = 3.2;
const MAX_RADIUS_SCALE = 6;
const SURFACE_CLEARANCE_M = 40;
const MESH_REBUILD_DELAY_MS = 80;

interface OrbitState {
  theta: number;
  phi: number;
  distance: number;
}

interface PlanetCameraApi {
  setView: (view: Partial<OrbitState>) => void;
  getView: () => OrbitState;
}

export function PlanetScene({ statsRef }: { statsRef: RefObject<HTMLPreElement | null> }) {
  const params = usePlanetStore((state) => state.params);
  const debugChannel = usePlanetStore((state) => state.debugChannel);
  const [displayParams, setDisplayParams] = useState(params);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);
  const root = useMemo(() => new Group(), []);
  const sun = useMemo(() => new DirectionalLight("#fff4e0", 1.55), []);
  const look = useMemo(() => new Vector3(), []);
  const orbit = useRef<OrbitState>({ theta: 0.75, phi: 0.95, distance: -1 });
  const radiusScale = useRef(0);
  const planetRef = useRef<Planet>(createPlanet(displayParams));
  const channelRef = useRef(debugChannel);
  const managerRef = useRef<ChunkMeshManager | null>(null);

  useEffect(() => {
    if (displayParams === params) return;
    const handle = window.setTimeout(() => setDisplayParams(params), MESH_REBUILD_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [params, displayParams]);

  const planet = useMemo(() => createPlanet(displayParams), [displayParams]);
  planetRef.current = planet;
  channelRef.current = debugChannel;

  const source = useMemo(
    () =>
      createPlanetChunkSource(
        () => planetRef.current,
        () => channelRef.current,
      ),
    [],
  );

  useEffect(() => {
    const manager = createChunkMeshManager(root, source);
    managerRef.current = manager;
    return () => {
      manager.dispose();
      if (managerRef.current === manager) managerRef.current = null;
    };
  }, [root, source]);

  useEffect(() => {
    return () => source.dispose();
  }, [source]);

  useEffect(() => {
    const element = gl.domElement;
    const state = orbit.current;
    let dragging = false;
    let pointerX = 0;
    let pointerY = 0;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      dragging = true;
      pointerX = event.clientX;
      pointerY = event.clientY;
      element.setPointerCapture(event.pointerId);
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      if (element.hasPointerCapture(event.pointerId))
        element.releasePointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - pointerX;
      const dy = event.clientY - pointerY;
      pointerX = event.clientX;
      pointerY = event.clientY;
      applyOrbitDrag(state, dx, dy);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      state.distance *= Math.exp(event.deltaY * 0.0012);
    };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (event.key === "=" || event.key === "+" || event.key === "]") state.distance *= 0.85;
      else if (event.key === "-" || event.key === "_" || event.key === "[") state.distance *= 1.18;
    };

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerUp);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerUp);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [gl]);

  useEffect(() => {
    const api: PlanetCameraApi = {
      setView(view) {
        if (view.theta !== undefined) orbit.current.theta = view.theta;
        if (view.phi !== undefined) orbit.current.phi = view.phi;
        if (view.distance !== undefined) orbit.current.distance = view.distance;
      },
      getView: () => ({ ...orbit.current }),
    };
    const host = window as Window & { __planetCamera?: PlanetCameraApi };
    host.__planetCamera = api;
    return () => {
      if (host.__planetCamera === api) delete host.__planetCamera;
    };
  }, []);

  useFrame(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const active = planetRef.current;
    const radius = active.params.radius;
    const state = orbit.current;
    if (state.distance < 0 || radiusScale.current === 0) {
      state.distance = radius * ORBIT_RADIUS_SCALE;
      radiusScale.current = radius;
    } else if (radiusScale.current !== radius) {
      state.distance *= radius / radiusScale.current;
      radiusScale.current = radius;
    }

    const unit = spherical(1, state.theta, state.phi);
    const ground = radius + active.sample(unit).height;
    const minDistance = ground + SURFACE_CLEARANCE_M;
    const maxDistance = radius * MAX_RADIUS_SCALE + Math.abs(active.params.amplitude);
    state.distance = Math.min(maxDistance, Math.max(minDistance, state.distance));

    const cameraWorld = spherical(state.distance, state.theta, state.phi);
    const up = viewUp(unit.x, unit.y, unit.z);
    camera.up.set(up.x, up.y, up.z);
    camera.position.set(0, 0, 0);
    camera.lookAt(-cameraWorld.x, -cameraWorld.y, -cameraWorld.z);
    const clearance = Math.max(1, state.distance - ground);
    camera.near = Math.max(0.2, Math.min(clearance * 0.1, 2_000));
    camera.far = Math.max(
      camera.near + 1,
      state.distance + radius + Math.abs(active.params.amplitude) + 1_000,
    );
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    camera.getWorldDirection(look);
    sun.position.set(-look.x + 0.4, -look.y + 0.75, -look.z + 0.2);
    sun.target.position.copy(look);
    sun.target.updateMatrixWorld();

    const manager = managerRef.current;
    if (!manager) return;
    const lodInput = {
      cameraPosition: cameraWorld,
      radius,
      fovY: (camera.fov * Math.PI) / 180,
      screenHeight: Math.max(1, size.height * gl.getPixelRatio()),
      relief: Math.abs(active.params.amplitude),
    };
    const selectStarted = performance.now();
    const plan = selectChunkPlan(lodInput);
    const retainStarted = performance.now();
    source.retain(plan.chunks, lodInput, plan.scores);
    const syncStarted = performance.now();
    const stats = manager.sync({
      selection: plan.chunks,
      cameraWorld,
      camera,
      cacheKey: `${channelRef.current}:${JSON.stringify(active.params)}`,
      planetRadius: radius,
      relief: Math.abs(active.params.amplitude),
    });
    if (statsRef.current) statsRef.current.textContent = formatChunkStats(stats);
    const finished = performance.now();
    const perfHost = window as Window & {
      __planetPerf?: { selectMs: number; retainMs: number; syncMs: number };
    };
    const previous = perfHost.__planetPerf;
    perfHost.__planetPerf = {
      selectMs: Math.max(previous?.selectMs ?? 0, retainStarted - selectStarted),
      retainMs: Math.max(previous?.retainMs ?? 0, syncStarted - retainStarted),
      syncMs: Math.max(previous?.syncMs ?? 0, finished - syncStarted),
    };
  });

  return (
    <>
      <primitive object={sun} />
      <primitive object={sun.target} />
      <ambientLight intensity={0.32} />
      <primitive object={root} />
    </>
  );
}
