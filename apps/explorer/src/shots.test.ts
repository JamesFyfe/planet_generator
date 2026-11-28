import { describe, expect, it } from "vitest";
import { sunDirection } from "@planet/renderer";
import { spherical } from "./orbit";
import { findShorePose, findSunsetPose } from "./shots";

describe("screenshot poses", () => {
  it("puts sunset on land at the terminator, looking toward the sun", () => {
    const pose = findSunsetPose(() => ({ height: 180, seaRelativeHeight: 180 }), 50_000, 0, 24);
    const radial = spherical(1, pose.theta, pose.phi);
    const sun = sunDirection(0, 24, pose.timeSeconds);
    const elev = radial.x * sun.x + radial.y * sun.y + radial.z * sun.z;
    expect(elev).toBeGreaterThan(0.05);
    expect(elev).toBeLessThan(0.25);
    expect(pose.pitch).toBe(1);
    expect(pose.distance).toBeGreaterThan(50_000);
  });

  it("finds a shore between wet and dry samples", () => {
    const pose = findShorePose(
      (dir) => {
        const wet = dir.x > 0;
        return { height: wet ? -20 : 30, seaRelativeHeight: wet ? -20 : 30 };
      },
      20_000,
      0,
    );
    const radial = spherical(1, pose.theta, pose.phi);
    expect(Math.abs(radial.x)).toBeLessThan(0.2);
    expect(pose.pitch).toBeLessThan(1);
  });
});
