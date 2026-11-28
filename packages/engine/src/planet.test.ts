import { describe, expect, it } from "vitest";
import { buildPlanetMesh, spherifyCube } from "./cubeSphere";
import { colorForChannel, DEBUG_CHANNEL_REGISTRY, isDebugChannelId } from "./debugChannels";
import {
  createPlanet,
  defaultPlanetParams,
  terrainRelief,
  type PlanetParams,
  type PlanetSample,
} from "./index";
import type { Vec3 } from "./noise/domainWarp";
import { clamp, cross, dot, normalize, sub } from "./vec3";

const DIRECTIONS: Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0.2, y: -0.4, z: 0.5 },
  { x: -0.3, y: 0.8, z: -0.2 },
];

function withParams(patch: Partial<PlanetParams>): PlanetParams {
  return { ...defaultPlanetParams(), ...patch };
}

function readVec(array: Float32Array, index: number): Vec3 {
  const offset = index * 3;
  return {
    x: array[offset] ?? 0,
    y: array[offset + 1] ?? 0,
    z: array[offset + 2] ?? 0,
  };
}

/**
 * Cube edges are where two coordinates are ±1. Nudge onto each adjacent face
 * so the samples sit on opposite sides of the seam a 2D map would introduce.
 */
function edgeStraddles(delta: number): Array<[Vec3, Vec3]> {
  const pairs: Array<[Vec3, Vec3]> = [];
  const signs = [1, -1] as const;
  for (const x of signs) {
    for (const y of signs) {
      pairs.push([
        spherifyCube({ x, y: y - Math.sign(y) * delta, z: 0 }),
        spherifyCube({ x: x - Math.sign(x) * delta, y, z: 0 }),
      ]);
    }
  }
  for (const x of signs) {
    for (const z of signs) {
      pairs.push([
        spherifyCube({ x, y: 0, z: z - Math.sign(z) * delta }),
        spherifyCube({ x: x - Math.sign(x) * delta, y: 0, z }),
      ]);
    }
  }
  for (const y of signs) {
    for (const z of signs) {
      pairs.push([
        spherifyCube({ x: 0, y, z: z - Math.sign(z) * delta }),
        spherifyCube({ x: 0, y: y - Math.sign(y) * delta, z }),
      ]);
    }
  }
  return pairs;
}

function poleRing(ySign: number, angle: number, count: number): Vec3[] {
  const dirs: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2;
    dirs.push({
      x: Math.sin(angle) * Math.cos(theta),
      y: ySign * Math.cos(angle),
      z: Math.sin(angle) * Math.sin(theta),
    });
  }
  return dirs;
}

describe("sample(dir)", () => {
  it("is deterministic and does not depend on call order", () => {
    const params = defaultPlanetParams();
    const planet = createPlanet(params);
    const first = DIRECTIONS.map((dir) => planet.sample(dir));
    createPlanet(withParams({ seed: 99 })).sample({ x: -4, y: 2, z: 0.5 });
    const second = DIRECTIONS.map((dir) => createPlanet(params).sample(dir));
    expect(second).toEqual(first);
    expect(first[0]).toEqual(createPlanet(params).sample({ x: 4, y: 0, z: 0 }));
  });

  it("locks a sample so the field cannot drift silently", () => {
    expect(createPlanet(defaultPlanetParams()).sample({ x: 0.2, y: -0.4, z: 0.5 }))
      .toMatchInlineSnapshot(`
        {
          "boundary": 4,
          "boundaryDistance": 0.016544163962826125,
          "crust": 1,
          "height": 6656.182988304317,
          "hotspot": 0,
          "plateId": 10,
          "seaRelativeHeight": 6656.182988304317,
          "uplift": 5903.24966796875,
        }
      `);
  });

  it("changes when the seed changes", () => {
    const base = DIRECTIONS.map((dir) => createPlanet(defaultPlanetParams()).sample(dir).height);
    const other = DIRECTIONS.map((dir) => createPlanet(withParams({ seed: 2 })).sample(dir).height);
    expect(other).not.toEqual(base);
  });

  it("uses the direction, not the vector length", () => {
    const planet = createPlanet(defaultPlanetParams());
    expect(planet.sample({ x: 2, y: -4, z: 5 })).toEqual(
      planet.sample({ x: 0.2, y: -0.4, z: 0.5 }),
    );
  });

  it("returns height in meters within the tectonic and noise span", () => {
    const params = defaultPlanetParams();
    const planet = createPlanet(params);
    const span = terrainRelief(params);
    for (const dir of DIRECTIONS) {
      const sample = planet.sample(dir);
      expect(sample.height).toBeGreaterThanOrEqual(-span);
      expect(sample.height).toBeLessThanOrEqual(span);
      expect(sample.seaRelativeHeight).toBe(sample.height - params.seaLevel);
    }
    const flooded = createPlanet(withParams({ seaLevel: 250 }));
    const dir = DIRECTIONS[5] as Vec3;
    expect(flooded.sample(dir).height).toBe(planet.sample(dir).height);
    expect(flooded.sample(dir).seaRelativeHeight).toBe(planet.sample(dir).height - 250);
  });

  it("scales height with amplitude and follows noise scale and octaves", () => {
    const dir = { x: 0.3, y: 0.5, z: -0.2 };
    const zero = createPlanet(withParams({ amplitude: 0 })).sample(dir).height;
    const full = createPlanet(defaultPlanetParams()).sample(dir).height;
    const half = createPlanet(withParams({ amplitude: 1_500 })).sample(dir).height;
    // Detail noise scales with amplitude. The tectonic shelf does not.
    expect((half - zero) * 2).toBeCloseTo(full - zero, 6);
    expect(createPlanet(withParams({ radius: 8_000 })).sample(dir).height).toBe(full);

    const defaults = DIRECTIONS.map(
      (direction) => createPlanet(defaultPlanetParams()).sample(direction).height,
    );
    expect(
      DIRECTIONS.map(
        (direction) => createPlanet(withParams({ octaves: 1 })).sample(direction).height,
      ),
    ).not.toEqual(defaults);
    expect(
      DIRECTIONS.map(
        (direction) => createPlanet(withParams({ noiseScale: 3.5 })).sample(direction).height,
      ),
    ).not.toEqual(defaults);
  });

  it("rejects a zero direction", () => {
    expect(() => createPlanet(defaultPlanetParams()).sample({ x: 0, y: 0, z: 0 })).toThrow(
      /non-zero/,
    );
  });

  it("has no discontinuity across cube edges", () => {
    // 1e-3 on the cube is a short step on the sphere. A lat/long or face-UV
    // seam jumps by a large fraction of the amplitude instead of a few meters.
    const delta = 1e-3;
    // The two samples sit up to about 0.01 apart. A trench can slope by
    // around a kilometer over that, while a broken shelf seam is several.
    const tolerance = 1_200;
    for (const seed of [1, 42]) {
      const planet = createPlanet(withParams({ seed }));
      for (const [left, right] of edgeStraddles(delta)) {
        expect(Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)).toBeLessThan(0.01);
        const gap = Math.abs(planet.sample(left).height - planet.sample(right).height);
        expect(gap).toBeLessThan(tolerance);
      }
    }
  });

  it("has no discontinuity at the poles or across the antimeridian", () => {
    // 0.02 rad can cross a trench. The check is still far below a broken pole seam.
    const tolerance = 2_000;
    const angle = 0.02;
    for (const seed of [1, 42]) {
      const planet = createPlanet(withParams({ seed }));
      for (const ySign of [1, -1]) {
        const center = planet.sample({ x: 0, y: ySign, z: 0 }).height;
        const ring = poleRing(ySign, angle, 8).map((dir) => planet.sample(dir).height);
        expect(Math.max(...ring) - Math.min(...ring)).toBeLessThan(tolerance);
        for (const height of ring) expect(Math.abs(height - center)).toBeLessThan(tolerance);
      }
      const eps = 1e-3;
      const east = planet.sample({ x: -Math.cos(eps), y: 0, z: Math.sin(eps) }).height;
      const west = planet.sample({ x: -Math.cos(eps), y: 0, z: -Math.sin(eps) }).height;
      expect(Math.abs(east - west)).toBeLessThan(400);
    }
  });
});

describe("spherified cube", () => {
  it("keeps face centers on their axes and corners on the sphere", () => {
    expect(spherifyCube({ x: 1, y: 0, z: 0 })).toEqual({ x: 1, y: 0, z: 0 });
    expect(spherifyCube({ x: 0, y: -1, z: 0 })).toEqual({ x: 0, y: -1, z: 0 });
    const corner = spherifyCube({ x: 1, y: 1, z: 1 });
    expect(Math.hypot(corner.x, corner.y, corner.z)).toBeCloseTo(1, 10);
    expect(corner.x).toBeCloseTo(corner.y, 10);
    expect(corner.y).toBeCloseTo(corner.z, 10);
  });

  it("keeps vertex spacing roughly even on a face", () => {
    const mesh = buildPlanetMesh(createPlanet(withParams({ amplitude: 0 })), "terrain", 16);
    const segments = 16;
    const stride = segments + 1;
    const face = 4;
    let min = Number.POSITIVE_INFINITY;
    let max = 0;
    for (let j = 0; j <= segments; j++) {
      for (let i = 0; i < segments; i++) {
        const row = face * stride * stride + j * stride;
        min = Math.min(
          min,
          angleBetween(readVec(mesh.positions, row + i), readVec(mesh.positions, row + i + 1)),
        );
        if (j < segments) {
          min = Math.min(
            min,
            angleBetween(
              readVec(mesh.positions, row + i),
              readVec(mesh.positions, row + stride + i),
            ),
          );
        }
      }
    }
    for (let j = 0; j <= segments; j++) {
      for (let i = 0; i < segments; i++) {
        const row = face * stride * stride + j * stride;
        max = Math.max(
          max,
          angleBetween(readVec(mesh.positions, row + i), readVec(mesh.positions, row + i + 1)),
        );
        if (j < segments) {
          max = Math.max(
            max,
            angleBetween(
              readVec(mesh.positions, row + i),
              readVec(mesh.positions, row + stride + i),
            ),
          );
        }
      }
    }
    // Nowell's spherified cube lands near 1.64 here. A plain normalized cube is about 2.
    expect(max / min).toBeLessThan(1.7);
  });
});

function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(clamp(dot(normalize(a), normalize(b)), -1, 1));
}

describe("planet mesh", () => {
  it("is deterministic and builds one grid per cube face", () => {
    const planet = createPlanet(defaultPlanetParams());
    const first = buildPlanetMesh(planet, "terrain", 3);
    const second = buildPlanetMesh(createPlanet(defaultPlanetParams()), "terrain", 3);
    expect(second.positions).toEqual(first.positions);
    expect(second.normals).toEqual(first.normals);
    expect(second.colors).toEqual(first.colors);
    expect(second.indices).toEqual(first.indices);

    const stride = 4;
    expect(first.positions.length).toBe(6 * stride * stride * 3);
    expect(first.normals.length).toBe(first.positions.length);
    expect(first.colors.length).toBe(first.positions.length);
    expect(first.indices.length).toBe(6 * 3 * 3 * 6);
    const vertexCount = first.positions.length / 3;
    for (const index of first.indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(vertexCount);
    }
  });

  it("points finite-difference normals outward and winds triangles the same way", () => {
    const cases = [
      {
        amplitude: 0,
        continentalFraction: 0,
        mountainHeight: 0,
        riftDepth: 0,
        minAlignment: 0.999,
      },
      // A coarse collision ridge can lean past 80 degrees and still face outward.
      { amplitude: 3_000, minAlignment: 0.15 },
    ];
    for (const { minAlignment, ...overrides } of cases) {
      const mesh = buildPlanetMesh(createPlanet(withParams(overrides)), "terrain", 4);
      const vertexCount = mesh.positions.length / 3;
      for (let index = 0; index < vertexCount; index++) {
        const position = readVec(mesh.positions, index);
        const normal = readVec(mesh.normals, index);
        expect(Number.isFinite(normal.x + normal.y + normal.z)).toBe(true);
        const alignment = dot(normal, normalize(position));
        expect(alignment).toBeGreaterThan(minAlignment);
      }
      for (let triangle = 0; triangle < mesh.indices.length; triangle += 3) {
        const p0 = readVec(mesh.positions, mesh.indices[triangle] ?? 0);
        const p1 = readVec(mesh.positions, mesh.indices[triangle + 1] ?? 0);
        const p2 = readVec(mesh.positions, mesh.indices[triangle + 2] ?? 0);
        const geometric = cross(sub(p1, p0), sub(p2, p0));
        const mid = {
          x: (p0.x + p1.x + p2.x) / 3,
          y: (p0.y + p1.y + p2.y) / 3,
          z: (p0.z + p1.z + p2.z) / 3,
        };
        expect(dot(geometric, mid)).toBeGreaterThan(0);
      }
    }
  });

  it("matches duplicated vertices across cube edges", () => {
    const segments = 4;
    const mesh = buildPlanetMesh(createPlanet(withParams({ amplitude: 0 })), "slope", segments);
    const stride = segments + 1;
    const perFace = stride * stride;
    const vertexCount = mesh.positions.length / 3;
    for (let face = 0; face < 6; face++) {
      for (let j = 0; j <= segments; j++) {
        for (let i = 0; i <= segments; i++) {
          if (i !== 0 && i !== segments && j !== 0 && j !== segments) continue;
          const index = face * perFace + j * stride + i;
          const position = readVec(mesh.positions, index);
          const normal = readVec(mesh.normals, index);
          let matches = 0;
          for (let other = 0; other < vertexCount; other++) {
            const candidate = readVec(mesh.positions, other);
            if (
              candidate.x === position.x &&
              candidate.y === position.y &&
              candidate.z === position.z
            ) {
              matches += 1;
              expect(readVec(mesh.normals, other)).toEqual(normal);
            }
          }
          expect(matches).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("moves the surface with amplitude and recolors with sea level and the debug channel", () => {
    const base = buildPlanetMesh(createPlanet(defaultPlanetParams()), "terrain", 2);
    const taller = buildPlanetMesh(createPlanet(withParams({ amplitude: 8_000 })), "terrain", 2);
    const flooded = buildPlanetMesh(createPlanet(withParams({ seaLevel: 8_000 })), "terrain", 2);
    const height = buildPlanetMesh(createPlanet(defaultPlanetParams()), "height", 2);
    const slope = buildPlanetMesh(createPlanet(defaultPlanetParams()), "slope", 2);

    expect(taller.positions).not.toEqual(base.positions);
    expect(flooded.positions).toEqual(base.positions);
    expect(flooded.colors).not.toEqual(base.colors);
    expect(height.positions).toEqual(base.positions);
    expect(slope.positions).toEqual(base.positions);
    expect(height.colors).not.toEqual(slope.colors);
    expect(height.colors).not.toEqual(base.colors);
    expect(base.lit).toBe(true);
    expect(height.lit).toBe(false);
    expect(slope.lit).toBe(false);

    for (let i = 0; i < base.colors.length; i++) {
      const value = base.colors[i] ?? 0;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("rejects a bad resolution", () => {
    const planet = createPlanet(defaultPlanetParams());
    expect(() => buildPlanetMesh(planet, "terrain", 0)).toThrow(/segments/);
    expect(() => buildPlanetMesh(planet, "terrain", 1.5)).toThrow(/segments/);
  });
});

describe("debug channels", () => {
  it("registers terrain, height, slope, lod, and the tectonic views", () => {
    expect(DEBUG_CHANNEL_REGISTRY.map((channel) => channel.id)).toEqual([
      "terrain",
      "height",
      "slope",
      "lod",
      "plate",
      "boundary",
      "uplift",
      "crust",
      "hotspot",
    ]);
    expect(isDebugChannelId("height")).toBe(true);
    expect(isDebugChannelId("biome")).toBe(false);
  });

  it("colors ocean, shore, land, and high ground differently", () => {
    const params = defaultPlanetParams();
    const slope = 0;
    const ocean = colorForChannel("terrain", params, paint(-500), slope);
    const shore = colorForChannel("terrain", params, paint(20), slope);
    const land = colorForChannel("terrain", params, paint(1_200), slope);
    const high = colorForChannel("terrain", params, paint(3_000), slope);
    const colors = [ocean, shore, land, high];
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        expect(colors[i]).not.toEqual(colors[j]);
      }
    }
    expect(ocean[2]).toBeGreaterThan(ocean[0]);
    expect(colorForChannel("slope", params, landSample(0), 0)).not.toEqual(
      colorForChannel("slope", params, landSample(0), 0.3),
    );
    expect(colorForChannel("height", params, landSample(-1_000), 0)).not.toEqual(
      colorForChannel("height", params, landSample(2_000), 0),
    );
  });

  it("gives plates, crust, and boundaries distinct colors", () => {
    const params = defaultPlanetParams();
    const base = paint(0);
    expect(colorForChannel("plate", params, { ...base, plateId: 0 }, 0)).not.toEqual(
      colorForChannel("plate", params, { ...base, plateId: 1 }, 0),
    );
    expect(colorForChannel("crust", params, { ...base, crust: 0 }, 0)).not.toEqual(
      colorForChannel("crust", params, { ...base, crust: 1 }, 0),
    );
    expect(
      colorForChannel("boundary", params, { ...base, boundary: 4, boundaryDistance: 0 }, 0),
    ).not.toEqual(
      colorForChannel("boundary", params, { ...base, boundary: 5, boundaryDistance: 0 }, 0),
    );
    expect(colorForChannel("uplift", params, { ...base, uplift: 2_000 }, 0)).not.toEqual(
      colorForChannel("uplift", params, { ...base, uplift: -2_000 }, 0),
    );
    expect(colorForChannel("hotspot", params, { ...base, hotspot: 1 }, 0)).not.toEqual(
      colorForChannel("hotspot", params, base, 0),
    );
  });
});

function paint(seaRelativeHeight: number): PlanetSample {
  return {
    height: seaRelativeHeight,
    seaRelativeHeight,
    plateId: 0,
    crust: 1,
    boundary: 0,
    boundaryDistance: 1,
    uplift: 0,
    hotspot: 0,
  };
}

function landSample(seaRelativeHeight: number): PlanetSample {
  return paint(seaRelativeHeight);
}
