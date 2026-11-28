import {
  clampPlanetParam,
  defaultPlanetParams,
  type DebugChannelId,
  type PlanetParamKey,
  type PlanetParams,
} from "@planet/engine";
import { create } from "zustand";

/** Sim-seconds per real second. Not a planet parameter: time must not enter the engine. */
export const DEFAULT_TIME_SCALE = 60;
export const MAX_TIME_SCALE = 20_000;

interface PlanetState {
  params: PlanetParams;
  debugChannel: DebugChannelId;
  timeScale: number;
  setParam: (key: PlanetParamKey, value: number) => void;
  setDebugChannel: (channel: DebugChannelId) => void;
  setTimeScale: (value: number) => void;
  resetParams: () => void;
}

function clampTimeScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TIME_SCALE;
  return Math.min(MAX_TIME_SCALE, Math.max(0, value));
}

export const usePlanetStore = create<PlanetState>((set) => ({
  params: defaultPlanetParams(),
  debugChannel: "terrain",
  timeScale: DEFAULT_TIME_SCALE,
  setParam: (key, value) => {
    const next = clampPlanetParam(key, value);
    set((state) => {
      if (state.params[key] === next) return state;
      return { params: { ...state.params, [key]: next } };
    });
  },
  setDebugChannel: (channel) => {
    set((state) => {
      if (state.debugChannel === channel) return state;
      return { debugChannel: channel };
    });
  },
  setTimeScale: (value) => {
    const next = clampTimeScale(value);
    set((state) => {
      if (state.timeScale === next) return state;
      return { timeScale: next };
    });
  },
  resetParams: () => {
    set({ params: defaultPlanetParams() });
  },
}));
