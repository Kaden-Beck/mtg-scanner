import { describe, expect, it } from "vitest";
import { formatDateTime, statusBadgeClass, statusLabel } from "./sync-status-format";

describe("formatDateTime", () => {
  it("renders 'Never' for a null date", () => {
    expect(formatDateTime(null)).toBe("Never");
  });

  it("renders a formatted date otherwise", () => {
    expect(formatDateTime(new Date("2026-08-02T12:00:00Z"))).not.toBe("Never");
  });
});

describe("statusLabel / statusBadgeClass", () => {
  it("labels every sync status", () => {
    expect(statusLabel("never_run")).toBe("Never run");
    expect(statusLabel("running")).toBe("Running…");
    expect(statusLabel("success")).toBe("Success");
    expect(statusLabel("error")).toBe("Error");
  });

  it("returns a non-empty class for every status", () => {
    for (const status of ["never_run", "running", "success", "error"] as const) {
      expect(statusBadgeClass(status).length).toBeGreaterThan(0);
    }
  });
});
