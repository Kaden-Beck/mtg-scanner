import { describe, expect, it } from "vitest";
import { scanCommitRequestSchema, scanResolveRequestSchema, scanUndoRequestSchema } from "./scan";

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

describe("scanUndoRequestSchema", () => {
  it("requires a positive quantity delta", () => {
    const id = "0000419b-0bba-4488-8f7a-6194544ce91e";
    expect(() => scanUndoRequestSchema.parse({ collectionItemId: id, quantityDelta: 0 })).toThrow();
    expect(scanUndoRequestSchema.parse({ collectionItemId: id, quantityDelta: 1 })).toEqual({
      collectionItemId: id,
      quantityDelta: 1,
    });
  });
});
