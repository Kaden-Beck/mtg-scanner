import { describe, expect, it } from "vitest";
import { isStale } from "./staleness";

describe("isStale", () => {
  const now = new Date("2026-08-02T12:00:00Z");

  it("is not stale when never synced (no last-synced timestamp)", () => {
    expect(isStale(null, now)).toBe(false);
  });

  it("is not stale within 24h", () => {
    const lastSyncedAt = new Date("2026-08-02T00:00:01Z"); // 11h59m59s ago
    expect(isStale(lastSyncedAt, now)).toBe(false);
  });

  it("is stale just past 24h", () => {
    const lastSyncedAt = new Date("2026-08-01T11:59:59Z"); // 24h00m01s ago
    expect(isStale(lastSyncedAt, now)).toBe(true);
  });
});
