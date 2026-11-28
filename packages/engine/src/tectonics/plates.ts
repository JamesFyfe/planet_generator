import { createPrng } from "../prng";
import type { Prng } from "../prng";
import { domainWarp } from "../noise/domainWarp";
import type { Vec3 } from "../noise/domainWarp";
import type { PlanetParams } from "../params";
import { clamp } from "../vec3";

/** Oceanic crust subducts. Continental crust does not. */
export const CrustKind = {
  oceanic: 0,
  continental: 1,
} as const;

/**
 * Boundary class of the nearest plate pair.
 * `none` is only used when a planet has a single plate.
 */
export const BoundaryKind = {
  none: 0,
  transform: 1,
  rift: 2,
  ridge: 3,
  collision: 4,
  subduction: 5,
} as const;

export interface Plate {
  id: number;
  site: Vec3;
  crust: number;
  /** Unit Euler pole. Angular velocity is `pole * rate`. */
  pole: Vec3;
  /** Signed radians per unit time, before the activity slider scales relief. */
  rate: number;
}

export interface Hotspot {
  id: number;
  site: Vec3;
  /** Angular radius of the influence kernel, radians. */
  radius: number;
}

export interface BoundaryClass {
  kind: number;
  /** 0..1. Zero for transform motion, so a glancing boundary grows no relief. */
  strength: number;
  /** True when plate `a` is the one that subducts. */
  aSubducts: boolean;
}

export interface PlateNeighborhood {
  index: number;
  other: number;
  /** Radians from the sample to the bisector. Zero on the boundary. */
  distance: number;
}

/** Displacement scale of the boundary warp, in unit-sphere coordinates. */
export const WARP_FREQUENCY = 1.15;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const THETA_JITTER = GOLDEN_ANGLE * 0.85;
const HOTSPOT_RADIUS = 0.18;
/** |closing| below this fraction of the shear is strike-slip. */
const TRANSFORM_RATIO = 0.5;
/** Relative normal speed that saturates mountain and rift strength. */
const MOTION_FULL = 0.45;
/** Relative speed that saturates a collision between a grown plate and its parent. */
const CONVERGE_SPEED = 0.8;

function countInRange(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function randomUnit(rng: Prng): Vec3 {
  const y = rng.nextFloat(-1, 1);
  const theta = rng.nextFloat(0, Math.PI * 2);
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  return { x: ring * Math.cos(theta), y, z: ring * Math.sin(theta) };
}

/**
 * Even sites, then a seed spin and a bounded jitter. A fully random sphere
 * clumps plates; the golden lattice keeps every seed's cells a similar size
 * while the spin moves the continents.
 */
function fibonacciSite(index: number, count: number, spin: number, rng: Prng): Vec3 {
  const yJitter = (rng.next() - 0.5) / count;
  const y = clamp(1 - ((index + 0.5) / count) * 2 + yJitter, -1, 1);
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * index + spin + (rng.next() - 0.5) * THETA_JITTER;
  return { x: ring * Math.cos(theta), y, z: ring * Math.sin(theta) };
}

export interface PlateModel {
  plates: Plate[];
  hotspots: Hotspot[];
  warpSeed: number;
  warpAmount: number;
}

interface CrustLink {
  child: number;
  parent: number;
}

/**
 * Continental plates grow out from a few shuffled kernels so each landmass
 * shares a boundary. Independent crust left most continents isolated, and a
 * collision belt needs two continents that actually touch.
 */
function assignClusteredCrust(
  plates: Plate[],
  kernelOrder: readonly number[],
  continentalCount: number,
): CrustLink[] {
  const links: CrustLink[] = [];
  if (continentalCount <= 0) return links;
  const continental = new Set<number>();
  const kernelCount = continentalCount === 1 ? 1 : Math.max(1, Math.floor(continentalCount / 2));
  for (let i = 0; i < kernelCount && continental.size < continentalCount; i++) {
    const id = kernelOrder[i];
    if (id !== undefined) continental.add(id);
  }
  while (continental.size < continentalCount) {
    let bestId = -1;
    let bestParent = -1;
    let bestDist = Infinity;
    for (const plate of plates) {
      if (continental.has(plate.id)) continue;
      for (const parentId of continental) {
        const parent = plates[parentId];
        if (!parent) continue;
        const dx = plate.site.x - parent.site.x;
        const dy = plate.site.y - parent.site.y;
        const dz = plate.site.z - parent.site.z;
        const dist = dx * dx + dy * dy + dz * dz;
        if (dist < bestDist) {
          bestDist = dist;
          bestId = plate.id;
          bestParent = parentId;
        }
      }
    }
    if (bestId < 0 || bestParent < 0) break;
    continental.add(bestId);
    links.push({ child: bestId, parent: bestParent });
  }
  for (const plate of plates) {
    plate.crust = continental.has(plate.id) ? CrustKind.continental : CrustKind.oceanic;
  }
  return links;
}

/**
 * Set `child` so it converges on `parent` at the site midpoint. The parent's
 * random spin stays, which keeps the belt's strike seed-dependent.
 */
function convergeOnto(parent: Plate, child: Plate): void {
  const mx = parent.site.x + child.site.x;
  const my = parent.site.y + child.site.y;
  const mz = parent.site.z + child.site.z;
  const mlen = Math.hypot(mx, my, mz);
  if (!(mlen > 1e-8)) return;
  const x = mx / mlen;
  const y = my / mlen;
  const z = mz / mlen;

  const sx = child.site.x - parent.site.x;
  const sy = child.site.y - parent.site.y;
  const sz = child.site.z - parent.site.z;
  const along = sx * x + sy * y + sz * z;
  let nx = sx - x * along;
  let ny = sy - y * along;
  let nz = sz - z * along;
  const nLen = Math.hypot(nx, ny, nz);
  if (!(nLen > 1e-8)) return;
  nx /= nLen;
  ny /= nLen;
  nz /= nLen;

  const velocity = plateVelocity(parent, { x, y, z });
  let tx = velocity.x - nx * CONVERGE_SPEED;
  let ty = velocity.y - ny * CONVERGE_SPEED;
  let tz = velocity.z - nz * CONVERGE_SPEED;
  const radial = tx * x + ty * y + tz * z;
  tx -= x * radial;
  ty -= y * radial;
  tz -= z * radial;

  const wx = y * tz - z * ty;
  const wy = z * tx - x * tz;
  const wz = x * ty - y * tx;
  const wLen = Math.hypot(wx, wy, wz);
  if (!(wLen > 1e-8)) return;
  child.pole = { x: wx / wLen, y: wy / wLen, z: wz / wLen };
  child.rate = wLen;
}

/**
 * Draw order is the seed stream: spin, sites, crust shuffle, poles, rates,
 * then hotspots. Grouping crust and steering a child into its parent uses
 * no further draws. Inserting a draw in the middle moves every later feature.
 */
export function createPlateModel(params: PlanetParams): PlateModel {
  const rng = createPrng(params.seed);
  const plateCount = countInRange(params.plateCount, 1, 64, 12);
  const hotspotCount = countInRange(params.hotspotCount, 0, 64, 0);
  const fraction = clamp(
    Number.isFinite(params.continentalFraction) ? params.continentalFraction : 0,
    0,
    1,
  );
  const spin = rng.next() * Math.PI * 2;

  const plates: Plate[] = [];
  for (let id = 0; id < plateCount; id++) {
    plates.push({
      id,
      site: fibonacciSite(id, plateCount, spin, rng),
      crust: CrustKind.oceanic,
      pole: { x: 0, y: 1, z: 0 },
      rate: 0,
    });
  }

  const order = plates.map((plate) => plate.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const swap = order[i] ?? i;
    order[i] = order[j] ?? j;
    order[j] = swap;
  }
  const continentalCount = Math.round(fraction * plateCount);
  const links = assignClusteredCrust(plates, order, continentalCount);

  for (const plate of plates) {
    plate.pole = randomUnit(rng);
    plate.rate = rng.nextFloat(-1, 1);
  }
  for (const link of links) {
    const child = plates[link.child];
    const parent = plates[link.parent];
    if (child && parent) convergeOnto(parent, child);
  }

  const hotspots: Hotspot[] = [];
  for (let id = 0; id < hotspotCount; id++) {
    hotspots.push({ id, site: randomUnit(rng), radius: HOTSPOT_RADIUS });
  }

  const warpAmount = Number.isFinite(params.boundaryWarp) ? Math.max(0, params.boundaryWarp) : 0;
  return {
    plates,
    hotspots,
    warpSeed: (Math.round(params.seed) + 0x51ed16e3) >>> 0,
    warpAmount,
  };
}

const warpScratch = { x: 0, y: 0, z: 0 };

/** Domain-warp a unit direction into `out`. Amount 0 leaves the point unchanged. */
export function warpDirection(seed: number, dir: Vec3, amount: number, out: Vec3): void {
  if (!(amount > 0)) {
    out.x = dir.x;
    out.y = dir.y;
    out.z = dir.z;
    return;
  }
  domainWarp(
    seed,
    dir.x,
    dir.y,
    dir.z,
    { amplitude: amount, frequency: WARP_FREQUENCY },
    warpScratch,
  );
  const len = Math.hypot(warpScratch.x, warpScratch.y, warpScratch.z);
  if (len < 1e-8) {
    out.x = dir.x;
    out.y = dir.y;
    out.z = dir.z;
    return;
  }
  const inv = 1 / len;
  out.x = warpScratch.x * inv;
  out.y = warpScratch.y * inv;
  out.z = warpScratch.z * inv;
}

/**
 * Nearest and second-nearest plate in chord distance. Ties go to the lower
 * id, so the cells partition the sphere: every point has one owner.
 */
export function findNeighborhood(
  plates: readonly Plate[],
  x: number,
  y: number,
  z: number,
  out: PlateNeighborhood,
): PlateNeighborhood {
  let best = Number.POSITIVE_INFINITY;
  let bestI = 0;
  let second = Number.POSITIVE_INFINITY;
  let secondI = 0;
  for (let i = 0; i < plates.length; i++) {
    const site = plates[i]?.site;
    if (!site) continue;
    const dx = x - site.x;
    const dy = y - site.y;
    const dz = z - site.z;
    const dist = dx * dx + dy * dy + dz * dz;
    const id = plates[i]?.id ?? i;
    const bestId = plates[bestI]?.id ?? bestI;
    if (dist < best || (dist === best && id < bestId)) {
      second = best;
      secondI = bestI;
      best = dist;
      bestI = i;
    } else if (
      i !== bestI &&
      (dist < second || (dist === second && id < (plates[secondI]?.id ?? secondI)))
    ) {
      second = dist;
      secondI = i;
    }
  }

  const owner = plates[bestI];
  const other = plates[secondI];
  let distance = Math.PI;
  if (owner && other && bestI !== secondI) {
    const ang1 = Math.acos(clamp(x * owner.site.x + y * owner.site.y + z * owner.site.z, -1, 1));
    const ang2 = Math.acos(clamp(x * other.site.x + y * other.site.y + z * other.site.z, -1, 1));
    distance = Math.max(0, (ang2 - ang1) / 2);
  }
  out.index = bestI;
  out.other = secondI;
  out.distance = distance;
  return out;
}

export function assignPlate(
  plates: readonly Plate[],
  dir: Vec3,
  warpSeed: number,
  warpAmount: number,
): Plate {
  const unit = {
    x: dir.x,
    y: dir.y,
    z: dir.z,
  };
  const len = Math.hypot(unit.x, unit.y, unit.z);
  if (!(len > 0)) throw new Error("direction must be a finite non-zero vector");
  unit.x /= len;
  unit.y /= len;
  unit.z /= len;
  const warped = { x: 0, y: 0, z: 0 };
  warpDirection(warpSeed, unit, warpAmount, warped);
  const hit = findNeighborhood(plates, warped.x, warped.y, warped.z, {
    index: 0,
    other: 0,
    distance: 0,
  });
  const plate = plates[hit.index];
  if (!plate) throw new Error("plate model is empty");
  return plate;
}

export function plateVelocity(plate: Plate, point: Vec3): Vec3 {
  const wx = plate.pole.x * plate.rate;
  const wy = plate.pole.y * plate.rate;
  const wz = plate.pole.z * plate.rate;
  return {
    x: wy * point.z - wz * point.y,
    y: wz * point.x - wx * point.z,
    z: wx * point.y - wy * point.x,
  };
}

/**
 * Relative motion of `a` against `b` at a unit point. Swapping the plates
 * leaves `kind` and `strength` unchanged, because both the relative velocity
 * and the boundary normal flip.
 */
export function writeBoundary(
  a: Plate,
  b: Plate,
  x: number,
  y: number,
  z: number,
  out: BoundaryClass,
): BoundaryClass {
  const sx = b.site.x - a.site.x;
  const sy = b.site.y - a.site.y;
  const sz = b.site.z - a.site.z;
  const along = sx * x + sy * y + sz * z;
  const nx = sx - x * along;
  const ny = sy - y * along;
  const nz = sz - z * along;
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen < 1e-8 || a.id === b.id) {
    out.kind = BoundaryKind.none;
    out.strength = 0;
    out.aSubducts = false;
    return out;
  }
  const invN = 1 / nLen;
  const nxx = nx * invN;
  const nyy = ny * invN;
  const nzz = nz * invN;

  const wax = a.pole.x * a.rate;
  const way = a.pole.y * a.rate;
  const waz = a.pole.z * a.rate;
  const wbx = b.pole.x * b.rate;
  const wby = b.pole.y * b.rate;
  const wbz = b.pole.z * b.rate;
  const vax = way * z - waz * y;
  const vay = waz * x - wax * z;
  const vaz = wax * y - way * x;
  const vbx = wby * z - wbz * y;
  const vby = wbz * x - wbx * z;
  const vbz = wbx * y - wby * x;
  const rx = vax - vbx;
  const ry = vay - vby;
  const rz = vaz - vbz;

  const tx = y * nzz - z * nyy;
  const ty = z * nxx - x * nzz;
  const tz = x * nyy - y * nxx;
  const closing = rx * nxx + ry * nyy + rz * nzz;
  const shear = Math.abs(rx * tx + ry * ty + rz * tz);
  const incomingA = vax * nxx + vay * nyy + vaz * nzz;
  const incomingB = -(vbx * nxx + vby * nyy + vbz * nzz);

  const oceanA = a.crust === CrustKind.oceanic;
  const oceanB = b.crust === CrustKind.oceanic;
  let aSubducts = false;
  if (oceanA && !oceanB) aSubducts = true;
  else if (!oceanA && oceanB) aSubducts = false;
  else if (oceanA && oceanB) {
    if (incomingA !== incomingB) aSubducts = incomingA > incomingB;
    else aSubducts = a.id > b.id;
  }

  const transformLimit = TRANSFORM_RATIO * shear;
  const normal = Math.abs(closing);
  if (normal <= transformLimit) {
    out.kind = BoundaryKind.transform;
    out.strength = 0;
    out.aSubducts = aSubducts;
    return out;
  }

  if (closing > 0) {
    out.kind =
      a.crust === CrustKind.continental && b.crust === CrustKind.continental
        ? BoundaryKind.collision
        : BoundaryKind.subduction;
  } else {
    out.kind =
      a.crust === CrustKind.oceanic && b.crust === CrustKind.oceanic
        ? BoundaryKind.ridge
        : BoundaryKind.rift;
  }
  out.strength = clamp((normal - transformLimit) / MOTION_FULL, 0, 1);
  out.aSubducts = aSubducts;
  return out;
}

export function classifyBoundary(a: Plate, b: Plate, point: Vec3): BoundaryClass {
  const len = Math.hypot(point.x, point.y, point.z);
  if (!(len > 0)) throw new Error("direction must be a finite non-zero vector");
  return writeBoundary(a, b, point.x / len, point.y / len, point.z / len, {
    kind: BoundaryKind.none,
    strength: 0,
    aSubducts: false,
  });
}

/** Angular distance from `dir` to each hotspot, for phases that place features. */
export function hotspotsWithin(hotspots: readonly Hotspot[], dir: Vec3, angle: number): Hotspot[] {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (!(len > 0)) throw new Error("direction must be a finite non-zero vector");
  const x = dir.x / len;
  const y = dir.y / len;
  const z = dir.z / len;
  const found: Hotspot[] = [];
  for (const hotspot of hotspots) {
    const cosine = clamp(x * hotspot.site.x + y * hotspot.site.y + z * hotspot.site.z, -1, 1);
    if (Math.acos(cosine) <= angle) found.push(hotspot);
  }
  return found;
}

export function hotspotInfluence(
  hotspots: readonly Hotspot[],
  x: number,
  y: number,
  z: number,
): number {
  let max = 0;
  for (const hotspot of hotspots) {
    const cosine = clamp(x * hotspot.site.x + y * hotspot.site.y + z * hotspot.site.z, -1, 1);
    const ang = Math.acos(cosine);
    if (ang >= hotspot.radius) continue;
    const t = 1 - ang / hotspot.radius;
    const weight = t * t * (3 - 2 * t);
    if (weight > max) max = weight;
  }
  return max;
}
