import { describe, expect, it } from "vitest";
import { guideSourceRect, objectCoverSourceRect, SCAN_GUIDE_INSET } from "./capture-frame";

describe("objectCoverSourceRect", () => {
  it("crops the sides when the source is wider than the dest", () => {
    // 1920×1080 into a 3:4 portrait box → horizontal crop.
    const rect = objectCoverSourceRect(1920, 1080, 300, 400);
    expect(rect.sy).toBe(0);
    expect(rect.sh).toBe(1080);
    expect(rect.sw).toBeCloseTo(1080 * (300 / 400));
    expect(rect.sx).toBeCloseTo((1920 - rect.sw) / 2);
  });

  it("crops top/bottom when the source is taller than the dest", () => {
    const rect = objectCoverSourceRect(1000, 2000, 400, 400);
    expect(rect.sx).toBe(0);
    expect(rect.sw).toBe(1000);
    expect(rect.sh).toBeCloseTo(1000);
    expect(rect.sy).toBeCloseTo(500);
  });
});

describe("guideSourceRect", () => {
  it("shrinks the cover rect by the scan guide inset", () => {
    const cover = objectCoverSourceRect(1920, 1080, 300, 400);
    const guide = guideSourceRect(1920, 1080, 300, 400, SCAN_GUIDE_INSET);
    expect(guide.sx).toBeCloseTo(cover.sx + cover.sw * SCAN_GUIDE_INSET);
    expect(guide.sy).toBeCloseTo(cover.sy + cover.sh * SCAN_GUIDE_INSET);
    expect(guide.sw).toBeCloseTo(cover.sw * (1 - 2 * SCAN_GUIDE_INSET));
    expect(guide.sh).toBeCloseTo(cover.sh * (1 - 2 * SCAN_GUIDE_INSET));
  });

  it("keeps the guide inside the source frame", () => {
    const guide = guideSourceRect(1920, 1080, 300, 400);
    expect(guide.sx).toBeGreaterThanOrEqual(0);
    expect(guide.sy).toBeGreaterThanOrEqual(0);
    expect(guide.sx + guide.sw).toBeLessThanOrEqual(1920 + 0.001);
    expect(guide.sy + guide.sh).toBeLessThanOrEqual(1080 + 0.001);
  });
});
