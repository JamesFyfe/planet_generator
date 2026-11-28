import {
  PLANET_PARAM_REGISTRY,
  applyPlanetPreset,
  clampPlanetParam,
  decodePlanetQuery,
  defaultPlanetParams,
  planetPreset,
  type DebugChannelId,
  type PlanetParamKey,
  type PlanetParams,
} from "@planet/engine";
import { create } from "zustand";

interface PlanetState {
  params: PlanetParams;
  debugChannel: DebugChannelId;
  /** Bumped when params change from outside the slider panel, so leva rebuilds. */
  panelEpoch: number;
  setParam: (key: PlanetParamKey, value: number) => void;
  setDebugChannel: (channel: DebugChannelId) => void;
  replaceParams: (params: PlanetParams) => void;
  applyPreset: (id: string) => void;
  resetParams: () => void;
}

function initialParams(): PlanetParams {
  if (typeof window === "undefined") return defaultPlanetParams();
  return decodePlanetQuery(window.location.search);
}

function clampedParams(incoming: PlanetParams): PlanetParams {
  const next = defaultPlanetParams();
  for (const meta of PLANET_PARAM_REGISTRY) {
    next[meta.key] = clampPlanetParam(meta.key, incoming[meta.key]);
  }
  return next;
}

export const usePlanetStore = create<PlanetState>((set) => ({
  params: initialParams(),
  debugChannel: "terrain",
  panelEpoch: 0,
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
  replaceParams: (params) => {
    set((state) => ({ params: clampedParams(params), panelEpoch: state.panelEpoch + 1 }));
  },
  applyPreset: (id) => {
    const preset = planetPreset(id);
    if (!preset) return;
    set((state) => ({
      params: applyPlanetPreset(state.params, preset),
      panelEpoch: state.panelEpoch + 1,
    }));
  },
  resetParams: () => {
    set((state) => ({ params: defaultPlanetParams(), panelEpoch: state.panelEpoch + 1 }));
  },
}));
