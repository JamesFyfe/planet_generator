import { create } from "zustand";
import {
  clampPlanetParam,
  defaultPlanetParams,
  type PlanetParamKey,
  type PlanetParams,
} from "@planet/engine";

interface PlanetState {
  params: PlanetParams;
  setParam: (key: PlanetParamKey, value: number) => void;
  resetParams: () => void;
}

export const usePlanetStore = create<PlanetState>((set) => ({
  params: defaultPlanetParams(),
  setParam: (key, value) => {
    const next = clampPlanetParam(key, value);
    set((state) => {
      if (state.params[key] === next) return state;
      return { params: { ...state.params, [key]: next } };
    });
  },
  resetParams: () => {
    set({ params: defaultPlanetParams() });
  },
}));
