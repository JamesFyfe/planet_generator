import {
  clampPlanetParam,
  defaultPlanetParams,
  type DebugChannelId,
  type PlanetParamKey,
  type PlanetParams,
} from "@planet/engine";
import { create } from "zustand";

interface PlanetState {
  params: PlanetParams;
  debugChannel: DebugChannelId;
  setParam: (key: PlanetParamKey, value: number) => void;
  setDebugChannel: (channel: DebugChannelId) => void;
  resetParams: () => void;
}

export const usePlanetStore = create<PlanetState>((set) => ({
  params: defaultPlanetParams(),
  debugChannel: "terrain",
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
  resetParams: () => {
    set({ params: defaultPlanetParams() });
  },
}));
