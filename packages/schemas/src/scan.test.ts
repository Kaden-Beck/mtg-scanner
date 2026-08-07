import { describe, expect, it } from "vitest";
import { scanCommitRequestSchema, scanResolveRequestSchema } from "./scan";

describe("scanResolveRequestSchema", () => {
  it("lowercases the set code", () => {
    const parsed = scanResolveRequestSchema.parse({
      setCode: "FDN",
      collectorNumber: "0125",
    });
    expect(parsed.setCode).toBe("fdn");
    expect(parsed.collectorNumber).toBe("0125");
  });

  it("rejects an empty collector number", () => {
    expect(() => scanResolveRequestSchema.parse({ setCode: "fdn", collectorNumber: "" })).toThrow();
  });
});

describe("scanCommitRequestSchema", () => {
  it("defaults condition and quantity", () => {
    const id = "0000419b-0bba-4488-8f7a-6194544ce91e";
    const parsed = scanCommitRequestSchema.parse({
      scryfallId: id,
      finish: "foil",
    });
    expect(parsed.condition).toBe("NM");
    expect(parsed.quantity).toBe(1);
    expect(parsed.language).toBe("en");
  });
});
