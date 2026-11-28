import type { Vec3 } from "./noise/domainWarp";

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(v: Vec3, factor: number, out?: Vec3): Vec3 {
  if (out) {
    out.x = v.x * factor;
    out.y = v.y * factor;
    out.z = v.z * factor;
    return out;
  }
  return { x: v.x * factor, y: v.y * factor, z: v.z * factor };
}

export function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function normalize(v: Vec3, out?: Vec3): Vec3 {
  const magnitude = length(v);
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new Error("direction must be a finite non-zero vector");
  }
  return scale(v, 1 / magnitude, out);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
