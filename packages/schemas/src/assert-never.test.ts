import { describe, expect, it } from "vitest";
import { conditionLabel, finishLabel } from "./card-attributes";

describe("exhaustive switches over discriminated unions", () => {
  it("labels every finish", () => {
    expect(finishLabel("nonfoil")).toBe("Nonfoil");
    expect(finishLabel("foil")).toBe("Foil");
    expect(finishLabel("etched")).toBe("Etched Foil");
  });

  it("labels every condition", () => {
    expect(conditionLabel("NM")).toBe("Near Mint");
    expect(conditionLabel("DMG")).toBe("Damaged");
  });
});
