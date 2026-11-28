import type { BakeFieldSource } from "../bake/cubemap";
import type { PlanetParams } from "../params";
import { clamp } from "../vec3";
import {
  BoundaryKind,
  CrustKind,
  findNeighborhood,
  hotspotInfluence,
  warpDirection,
  writeBoundary,
} from "./plates";
import type { Hotspot, Plate, PlateModel } from "./plates";

/**
 * Meters. Shelves stay when activity is zero so continents are not only a
 * noise mask. Boundary sliders add ranges, rifts, trenches, and arcs on top.
 */
export const CONTINENT_SHELF_M = 2_000;
export const OCEAN_BASIN_M = 3_600;

const COAST_RADIANS = 0.08;
const COLLISION_RADIANS = 0.22;
const RIFT_RADIANS = 0.07;
const RIDGE_RADIANS = 0.14;
const TRENCH_END = 0.09;
const ARC_START = 0.035;
const ARC_END = 0.17;

/**
 * Channels written by {@link tectonicFieldSource}. Append a spec and a write
 * in that source to put another scalar on the same cubemap.
 */
export const TECTONIC_CHANNELS = [
  { id: "height", filter: "bilinear" },
  { id: "uplift", filter: "bilinear" },
  { id: "boundaryDistance", filter: "bilinear" },
  { id: "hotspot", filter: "bilinear" },
  { id: "plateId", filter: "nearest" },
  { id: "boundary", filter: "nearest" },
  { id: "crust", filter: "nearest" },
] as const;

export function tectonicActivity(params: PlanetParams): number {
  if (!Number.isFinite(params.tectonicActivity)) return 0;
  return Math.max(0, params.tectonicActivity);
}

export function tectonicReliefMeters(params: PlanetParams): number {
  const activity = tectonicActivity(params);
  const mountains = Math.max(0, params.mountainHeight) * activity;
  const rifts = Math.max(0, params.riftDepth) * activity;
  return CONTINENT_SHELF_M + OCEAN_BASIN_M + mountains + rifts;
}

/** Largest |radial displacement| the height function can produce, in meters. */
export function terrainRelief(params: PlanetParams): number {
  return tectonicReliefMeters(params) + Math.abs(params.amplitude);
}

function smooth01(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** 1 on the boundary, 0 outside `width` radians. */
function ridgeFalloff(distance: number, width: number): number {
  if (distance >= width) return 0;
  return smooth01(1 - distance / width);
}

/** Zero at and outside the interval, so a one-sided trench meets the other plate at 0. */
function lobe(distance: number, start: number, end: number): number {
  if (distance <= start || distance >= end) return 0;
  const t = (distance - start) / (end - start);
  const s = Math.sin(Math.PI * t);
  return s * s;
}

function boundaryRelief(
  params: PlanetParams,
  kind: number,
  strength: number,
  distance: number,
  sameCrust: boolean,
  ownerSubducts: boolean,
): number {
  const activity = tectonicActivity(params);
  if (activity === 0 || strength === 0) return 0;
  const mountains = Math.max(0, params.mountainHeight) * activity * strength;
  const rifts = Math.max(0, params.riftDepth) * activity * strength;
  if (kind === BoundaryKind.collision) {
    return mountains * ridgeFalloff(distance, COLLISION_RADIANS);
  }
  if (kind === BoundaryKind.rift) {
    return -rifts * (sameCrust ? 1 : 0.35) * ridgeFalloff(distance, RIFT_RADIANS);
  }
  if (kind === BoundaryKind.ridge) {
    return mountains * 0.5 * ridgeFalloff(distance, RIDGE_RADIANS);
  }
  if (kind === BoundaryKind.subduction) {
    if (ownerSubducts) return -rifts * lobe(distance, 0, TRENCH_END);
    return mountains * 0.65 * lobe(distance, ARC_START, ARC_END);
  }
  return 0;
}

export function tectonicFieldSource(params: PlanetParams, model: PlateModel): BakeFieldSource {
  const warped = { x: 0, y: 0, z: 0 };
  const neighborhood = { index: 0, other: 0, distance: 0 };
  const boundary = { kind: BoundaryKind.none, strength: 0, aSubducts: false };
  const plates = model.plates;
  const hotspots: readonly Hotspot[] = model.hotspots;

  return {
    specs: TECTONIC_CHANNELS,
    write(dir, out, offset) {
      warpDirection(model.warpSeed, dir, model.warpAmount, warped);
      findNeighborhood(plates, warped.x, warped.y, warped.z, neighborhood);
      const owner: Plate | undefined = plates[neighborhood.index];
      const other: Plate | undefined = plates[neighborhood.other];
      if (!owner || !other) {
        out[offset] = 0;
        out[offset + 1] = 0;
        out[offset + 2] = Math.PI;
        out[offset + 3] = 0;
        out[offset + 4] = 0;
        out[offset + 5] = BoundaryKind.none;
        out[offset + 6] = CrustKind.oceanic;
        return;
      }

      const distance = neighborhood.distance;
      if (owner.id === other.id) {
        boundary.kind = BoundaryKind.none;
        boundary.strength = 0;
        boundary.aSubducts = false;
      } else {
        writeBoundary(owner, other, warped.x, warped.y, warped.z, boundary);
      }

      const shelf = owner.crust === CrustKind.continental ? CONTINENT_SHELF_M : -OCEAN_BASIN_M;
      const sameCrust = owner.crust === other.crust;
      const base = sameCrust ? shelf : shelf * smooth01(distance / COAST_RADIANS);
      const uplift = boundaryRelief(
        params,
        boundary.kind,
        boundary.strength,
        distance,
        sameCrust,
        boundary.aSubducts,
      );

      out[offset] = base + uplift;
      out[offset + 1] = uplift;
      out[offset + 2] = distance;
      out[offset + 3] = hotspotInfluence(hotspots, dir.x, dir.y, dir.z);
      out[offset + 4] = owner.id;
      out[offset + 5] = boundary.kind;
      out[offset + 6] = owner.crust;
    },
  };
}
