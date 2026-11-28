import { createPlanet, selectChunks } from "@planet/engine";
import type { Planet, Vec3 } from "@planet/engine";
import { createChunkMeshManager, createPlanetVisuals, sunDirection } from "@planet/renderer";
import type { ChunkMeshManager, PlanetVisuals } from "@planet/renderer";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Group, PerspectiveCamera } from "three";
import { createPlanetChunkSource } from "./chunkSource";
import { formatChunkStats } from "./chunkStats";
import { applyOrbitDrag, pitchedLook, spherical, surfacePitch, viewUp } from "./orbit";
import type { OrbitVec } from "./orbit";
import { findShorePose, findSunsetPose } from "./shots";
import { usePlanetStore } from "./store";
import { terrainCacheKey } from "./terrainKey";

const ORBIT_RADIUS_SCALE = 3.2;
const MAX_RADIUS_SCALE = 6;
const SURFACE_CLEARANCE_M = 40;
const MESH_REBUILD_DELAY_MS = 80;

interface OrbitState {
  theta: number;
  phi: number;
  distance: number;
  glance: OrbitVec | null;
  /** Null follows altitude. A number forces the horizon pitch for a shot. */
  pitchOverride: number | null;
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
  const timeScale = usePlanetStore((state) => state.timeScale);
  const root = useMemo(() => new Group(), []);
  const orbit = useRef<OrbitState>({
    theta: 0.75,
    phi: 0.95,
    distance: -1,
    glance: null,
    pitchOverride: null,
  });
  const radiusScale = useRef(0);
  const timeRef = useRef(0);
  const timeScaleRef = useRef(timeScale);
  timeScaleRef.current = timeScale;
  const planetRef = useRef<Planet>(createPlanet(displayParams));
  const channelRef = useRef(debugChannel);
  const managerRef = useRef<ChunkMeshManager | null>(null);
  const visualsRef = useRef<PlanetVisuals | null>(null);

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
    const visuals = createPlanetVisuals(root);
    visualsRef.current = visuals;
    const manager = createChunkMeshManager(root, source, {
      attachments: [visuals.waterAttachment],
    });
    managerRef.current = manager;
    return () => {
      manager.dispose();
      visuals.dispose();
      if (managerRef.current === manager) managerRef.current = null;
      if (visualsRef.current === visuals) visualsRef.current = null;
    };
  }, [root, source]);

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
      state.glance = null;
      state.pitchOverride = null;
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
        if ("glance" in view) orbit.current.glance = view.glance ?? null;
        if ("pitchOverride" in view) orbit.current.pitchOverride = view.pitchOverride ?? null;
      },
      getView: () => ({ ...orbit.current }),
    };
    const applyPose = (pose: {
      theta: number;
      phi: number;
      distance: number;
      glance: Vec3;
      pitch: number;
      timeSeconds: number;
    }) => {
      usePlanetStore.getState().setTimeScale(0);
      timeRef.current = pose.timeSeconds;
      orbit.current.theta = pose.theta;
      orbit.current.phi = pose.phi;
      orbit.current.distance = pose.distance;
      orbit.current.glance = pose.glance;
      orbit.current.pitchOverride = pose.pitch;
    };
    const shot = {
      setTime: (seconds: number) => {
        timeRef.current = seconds;
      },
      setTimeScale: (scale: number) => {
        usePlanetStore.getState().setTimeScale(scale);
      },
      frameOrbit: () => {
        usePlanetStore.getState().setTimeScale(0);
        const params = planetRef.current.params;
        const facing = spherical(1, 0.75, 0.95);
        let bestTime = 0;
        let bestScore = Number.POSITIVE_INFINITY;
        const period = params.rotationPeriod * 3600;
        for (let step = 0; step < 72; step++) {
          const time = (step / 72) * period;
          const sun = sunDirection(params.axialTilt, params.rotationPeriod, time);
          const elev = facing.x * sun.x + facing.y * sun.y + facing.z * sun.z;
          const score = Math.abs(elev - 0.22);
          if (score < bestScore) {
            bestScore = score;
            bestTime = time;
          }
        }
        timeRef.current = bestTime;
        orbit.current.theta = 0.75;
        orbit.current.phi = 0.95;
        orbit.current.distance = params.radius * ORBIT_RADIUS_SCALE;
        orbit.current.glance = null;
        orbit.current.pitchOverride = 0;
      },
      frameSunset: () => {
        const planet = planetRef.current;
        applyPose(
          findSunsetPose(
            (dir) => planet.sample(dir),
            planet.params.radius,
            planet.params.axialTilt,
            planet.params.rotationPeriod,
          ),
        );
      },
      frameShore: () => {
        const planet = planetRef.current;
        applyPose(
          findShorePose(
            (dir) => planet.sample(dir),
            planet.params.radius,
            timeRef.current,
            planet.params.axialTilt,
            planet.params.rotationPeriod,
          ),
        );
      },
      frameAirless: () => {
        const store = usePlanetStore.getState();
        store.setTimeScale(0);
        store.setParam("atmosphereDensity", 0);
        store.setParam("cloudDensity", 0);
        store.setParam("cloudCoverage", 0);
        const radius = planetRef.current.params.radius;
        orbit.current.distance = radius * ORBIT_RADIUS_SCALE;
        orbit.current.glance = null;
        orbit.current.pitchOverride = 0;
      },
    };
    const host = window as Window & {
      __planetCamera?: PlanetCameraApi;
      __planetShot?: typeof shot;
    };
    host.__planetCamera = api;
    host.__planetShot = shot;
    return () => {
      if (host.__planetCamera === api) delete host.__planetCamera;
      if (host.__planetShot === shot) delete host.__planetShot;
    };
  }, []);

  useFrame((_, delta) => {
    if (!(camera instanceof PerspectiveCamera)) return;
    timeRef.current += Math.min(delta, 0.05) * timeScaleRef.current;
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
    const altitude = state.distance - ground;
    const pitch = state.pitchOverride ?? surfacePitch(altitude, radius);
    const screenUp = viewUp(unit.x, unit.y, unit.z);
    const aimed = pitchedLook(unit, screenUp, pitch, state.glance);
    camera.up.set(aimed.up.x, aimed.up.y, aimed.up.z);
    camera.position.set(0, 0, 0);
    camera.lookAt(aimed.look.x, aimed.look.y, aimed.look.z);
    const clearance = Math.max(1, state.distance - ground);
    camera.near = Math.max(0.2, Math.min(clearance * 0.1, 2_000));
    const shell = radius + active.params.seaLevel + active.params.atmosphereThickness;
    camera.far = Math.max(
      camera.near + 1,
      state.distance + shell + Math.abs(active.params.amplitude) + 2_000,
    );
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    const manager = managerRef.current;
    if (!manager) return;
    const selection = selectChunks({
      cameraPosition: cameraWorld,
      radius,
      fovY: (camera.fov * Math.PI) / 180,
      screenHeight: Math.max(1, size.height * gl.getPixelRatio()),
      relief: Math.abs(active.params.amplitude),
    });
    visualsRef.current?.update({
      params: active.params,
      timeSeconds: timeRef.current,
      cameraWorld,
      camera,
    });
    const stats = manager.sync({
      selection,
      cameraWorld,
      camera,
      cacheKey: terrainCacheKey(channelRef.current, active.params),
      planetRadius: radius,
      relief: Math.abs(active.params.amplitude),
    });
    if (statsRef.current) statsRef.current.textContent = formatChunkStats(stats);
  });

  return <primitive object={root} />;
}
