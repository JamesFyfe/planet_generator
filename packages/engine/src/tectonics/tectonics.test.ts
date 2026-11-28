import { describe, expect, it } from "vitest";
import { BAKE_RESOLUTION } from "../bake/cubemap";
import { cubeFacePoint, spherifyCube } from "../cubeSphere";
import {
  adoptGlobalBake,
  createGlobalBake,
  createPlanet,
  defaultPlanetParams,
  serializeGlobalBake,
  type PlanetParams,
} from "../index";
import type { Vec3 } from "../noise/domainWarp";
import {
  BoundaryKind,
  CrustKind,
  assignPlate,
  classifyBoundary,
  createPlateModel,
  findNeighborhood,
  hotspotInfluence,
  hotspotsWithin,
  warpDirection,
} from "./plates";
import type { Plate } from "./plates";

function withParams(patch: Partial<PlanetParams>): PlanetParams {
  return { ...defaultPlanetParams(), ...patch };
}

function plate(patch: Partial<Plate> & Pick<Plate, "id" | "site">): Plate {
  return {
    crust: CrustKind.continental,
    pole: { x: 0, y: 1, z: 0 },
    rate: 1,
    ...patch,
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sphereSamples(count: number): Vec3[] {
  const dirs: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - ((i + 0.5) / count) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    dirs.push({ x: ring * Math.cos(theta), y, z: ring * Math.sin(theta) });
  }
  return dirs;
}

describe("plates", () => {
  it("assigns every sample to exactly one nearest plate", () => {
    const model = createPlateModel(defaultPlanetParams());
    expect(new Set(model.plates.map((entry) => entry.id)).size).toBe(model.plates.length);
    const owners = new Set<number>();
    for (const dir of sphereSamples(256)) {
      const warped = { x: 0, y: 0, z: 0 };
      warpDirection(model.warpSeed, dir, model.warpAmount, warped);
      const owner = assignPlate(model.plates, dir, model.warpSeed, model.warpAmount);
      owners.add(owner.id);
      let best = Number.POSITIVE_INFINITY;
      let bestId = Number.POSITIVE_INFINITY;
      for (const entry of model.plates) {
        const dx = warped.x - entry.site.x;
        const dy = warped.y - entry.site.y;
        const dz = warped.z - entry.site.z;
        const dist = dx * dx + dy * dy + dz * dz;
        if (dist < best || (dist === best && entry.id < bestId)) {
          best = dist;
          bestId = entry.id;
        }
      }
      expect(owner.id).toBe(bestId);
      expect(model.plates.filter((entry) => entry.id === owner.id)).toHaveLength(1);
    }
    expect(owners.size).toBeGreaterThan(1);
  });

  it("breaks equidistant ties toward the lower plate id", () => {
    const high = plate({ id: 5, site: { x: 1, y: 0, z: 0 } });
    const low = plate({ id: 1, site: { x: -1, y: 0, z: 0 } });
    const mid = { x: 0, y: 0, z: 1 };
    expect(assignPlate([high, low], mid, 1, 0).id).toBe(1);
    expect(assignPlate([low, high], { x: 0.8, y: 0.1, z: 0 }, 1, 0).id).toBe(5);
    const hit = findNeighborhood([high, low], 0, 0, 1, { index: 0, other: 0, distance: 0 });
    expect(hit.distance).toBeCloseTo(0, 6);
  });

  it("classifies a plate pair the same way in either order", () => {
    const point = { x: 0, y: 0, z: 1 };
    const divergentA = plate({
      id: 0,
      site: { x: 1, y: 0, z: 0 },
      rate: 1,
      crust: CrustKind.continental,
    });
    const divergentB = plate({
      id: 1,
      site: { x: -1, y: 0, z: 0 },
      rate: -1,
      crust: CrustKind.continental,
    });
    const opening = classifyBoundary(divergentA, divergentB, point);
    const openingSwap = classifyBoundary(divergentB, divergentA, point);
    expect(opening.kind).toBe(BoundaryKind.rift);
    expect(openingSwap.kind).toBe(opening.kind);
    expect(openingSwap.strength).toBeCloseTo(opening.strength, 8);

    const collisionA = plate({ ...divergentA, rate: -1 });
    const collisionB = plate({ ...divergentB, rate: 1 });
    const collision = classifyBoundary(collisionA, collisionB, point);
    const collisionSwap = classifyBoundary(collisionB, collisionA, point);
    expect(collision.kind).toBe(BoundaryKind.collision);
    expect(collisionSwap.kind).toBe(collision.kind);
    expect(collisionSwap.strength).toBeCloseTo(collision.strength, 8);
    expect(collision.strength).toBeGreaterThan(0.5);

    const ocean = plate({
      id: 0,
      site: { x: 1, y: 0, z: 0 },
      rate: -1,
      crust: CrustKind.oceanic,
    });
    const continent = plate({
      id: 1,
      site: { x: -1, y: 0, z: 0 },
      rate: 1,
      crust: CrustKind.continental,
    });
    const subduction = classifyBoundary(ocean, continent, point);
    const subductionSwap = classifyBoundary(continent, ocean, point);
    expect(subduction.kind).toBe(BoundaryKind.subduction);
    expect(subductionSwap.kind).toBe(subduction.kind);
    expect(subductionSwap.strength).toBeCloseTo(subduction.strength, 8);
    expect(subduction.aSubducts).toBe(true);
    expect(subductionSwap.aSubducts).toBe(false);

    const shearA = plate({
      id: 0,
      site: { x: 1, y: 0, z: 0 },
      pole: { x: 1, y: 0, z: 0 },
      rate: 1,
    });
    const shearB = plate({
      id: 1,
      site: { x: -1, y: 0, z: 0 },
      pole: { x: 1, y: 0, z: 0 },
      rate: -1,
      crust: CrustKind.oceanic,
    });
    const transform = classifyBoundary(shearA, shearB, point);
    const transformSwap = classifyBoundary(shearB, shearA, point);
    expect(transform.kind).toBe(BoundaryKind.transform);
    expect(transformSwap.kind).toBe(transform.kind);
    expect(transform.strength).toBe(0);
    expect(transformSwap.strength).toBe(0);
  });

  it("steers grown continents into a collision with their parent", () => {
    for (const seed of [1, 7, 42]) {
      const model = createPlateModel(withParams({ seed }));
      const continents = model.plates.filter((entry) => entry.crust === CrustKind.continental);
      expect(continents).toHaveLength(4);
      let strong = 0;
      for (let i = 0; i < continents.length; i++) {
        for (let j = i + 1; j < continents.length; j++) {
          const a = continents[i];
          const b = continents[j];
          if (!a || !b) continue;
          const boundary = classifyBoundary(a, b, {
            x: a.site.x + b.site.x,
            y: a.site.y + b.site.y,
            z: a.site.z + b.site.z,
          });
          if (boundary.kind === BoundaryKind.collision && boundary.strength > 0.8) strong += 1;
        }
      }
      expect(strong).toBeGreaterThan(0);
    }
  });

  it("keeps hotspot kernels on the seeded points", () => {
    const model = createPlateModel(defaultPlanetParams());
    expect(model.hotspots).toHaveLength(defaultPlanetParams().hotspotCount);
    const hotspot = model.hotspots[0];
    if (!hotspot) throw new Error("expected a hotspot");
    expect(
      hotspotInfluence(model.hotspots, hotspot.site.x, hotspot.site.y, hotspot.site.z),
    ).toBeCloseTo(1, 5);
    expect(hotspotsWithin(model.hotspots, hotspot.site, 0.01).map((entry) => entry.id)).toContain(
      hotspot.id,
    );
    const antipode = { x: -hotspot.site.x, y: -hotspot.site.y, z: -hotspot.site.z };
    expect(
      hotspotsWithin(model.hotspots, antipode, 0.05).some((entry) => entry.id === hotspot.id),
    ).toBe(false);
  });
});

describe("global bake", () => {
  it("is deterministic and does not depend on call order", () => {
    const params = withParams({ seed: 3 });
    const first = createGlobalBake(params, 24);
    createGlobalBake(withParams({ seed: 9 }), 16);
    const second = createGlobalBake(params, 24);
    expect(second.plates).toEqual(first.plates);
    expect(second.hotspots).toEqual(first.hotspots);
    for (const dir of sphereSamples(16)) {
      expect(second.sample(dir)).toEqual(first.sample(dir));
    }
  });

  it("uses the production resolution and round-trips through a payload", () => {
    expect(BAKE_RESOLUTION).toBe(512);
    const params = defaultPlanetParams();
    const bake = createGlobalBake(params);
    expect(bake.resolution).toBe(512);
    const payload = serializeGlobalBake(bake);
    const cloned = {
      ...payload,
      channels: payload.channels.map((channel) => ({
        ...channel,
        data: new Float32Array(channel.data),
      })),
    };
    const adopted = adoptGlobalBake(params, cloned);
    const dir = { x: 0.2, y: -0.4, z: 0.5 };
    expect(adopted.sample(dir)).toEqual(bake.sample(dir));
    expect(createPlanet(params).bake.resolution).toBe(512);
  });

  it("keeps bilinear height continuous across a cube edge", () => {
    const bake = createGlobalBake(withParams({ seed: 4 }), 64);
    const deltas = [-0.4, 0.1, 0.55];
    for (const t of deltas) {
      const point = { x: 1, y: 1, z: t };
      const left = spherifyCube({ x: point.x - 1e-4, y: point.y, z: point.z });
      const right = spherifyCube({ x: point.x, y: point.y - 1e-4, z: point.z });
      expect(Math.abs(bake.sample(left).height - bake.sample(right).height)).toBeLessThan(80);
    }
  });

  it("puts the strongest uplift on continent-continent collisions", () => {
    const params = defaultPlanetParams();
    const bake = createGlobalBake(params, 48);
    const collision: number[] = [];
    const transform: number[] = [];
    let trench = 0;
    for (let face = 0; face < 6; face++) {
      for (let j = 0; j < 24; j++) {
        for (let i = 0; i < 24; i++) {
          const u = -1 + (2 * i) / 23;
          const v = -1 + (2 * j) / 23;
          const sample = bake.sample(spherifyCube(cubeFacePoint(face, u, v)));
          if (sample.boundaryDistance > 0.08) continue;
          if (sample.boundary === BoundaryKind.collision) collision.push(sample.uplift);
          if (sample.boundary === BoundaryKind.transform) transform.push(sample.uplift);
          if (sample.boundary === BoundaryKind.subduction) trench = Math.min(trench, sample.uplift);
        }
      }
    }
    expect(collision.length).toBeGreaterThan(0);
    expect(mean(collision)).toBeGreaterThan(500);
    expect(mean(collision)).toBeGreaterThan(mean(transform) + 400);
    expect(trench).toBeLessThan(0);
  });

  it("gives different seeds different plate layouts", () => {
    const first = createPlateModel(defaultPlanetParams());
    const second = createPlateModel(withParams({ seed: 2 }));
    let differ = 0;
    const dirs = sphereSamples(64);
    for (const dir of dirs) {
      const a = assignPlate(first.plates, dir, first.warpSeed, first.warpAmount).id;
      const b = assignPlate(second.plates, dir, second.warpSeed, second.warpAmount).id;
      if (a !== b) differ += 1;
    }
    expect(differ).toBeGreaterThan(dirs.length * 0.2);
  });

  it("adds the bake shelf under the detail noise", () => {
    const params = defaultPlanetParams();
    const planet = createPlanet(params);
    const dir = { x: 0.3, y: 0.5, z: -0.2 };
    const quiet = createPlanet(withParams({ amplitude: 0 })).sample(dir);
    const baked = planet.bake.sample(dir);
    expect(quiet.height).toBeCloseTo(baked.height, 3);
    expect(quiet.plateId).toBe(baked.plateId);
    expect(quiet.uplift).toBeCloseTo(baked.uplift, 3);
    const full = planet.sample(dir);
    expect(full.height).toBeCloseTo(quiet.height + (full.height - quiet.height), 6);
    expect(full.plateId).toBe(quiet.plateId);
  });
});
