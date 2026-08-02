import { describe, expect, it } from "vitest";
import { UNRESOLVED_REASONS } from "@/server/db/schema";
import { reasonLabel } from "./reconciliation-format";

describe("reasonLabel", () => {
  it("returns a non-empty label for every reason", () => {
    for (const reason of UNRESOLVED_REASONS) {
      expect(reasonLabel(reason).length).toBeGreaterThan(0);
    }
  });
});
