import { describe, expect, it } from "vitest";
import { RENDERER_PACKAGE } from "./index";

describe("renderer package", () => {
  it("keeps a stable public name", () => {
    expect(RENDERER_PACKAGE).toBe("@planet/renderer");
  });
});
