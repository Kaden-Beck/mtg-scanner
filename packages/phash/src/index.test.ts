import { describe, expect, it } from "vitest";
import { PHASH_PACKAGE_PLACEHOLDER } from "./index";

describe("packages/phash scaffold", () => {
  it("is wired into the workspace and test runner", () => {
    expect(PHASH_PACKAGE_PLACEHOLDER).toBe(true);
  });
});
