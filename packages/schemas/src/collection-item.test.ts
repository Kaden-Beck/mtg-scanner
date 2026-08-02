import { describe, expect, it } from "vitest";
import {
  createCollectionItemRequestSchema,
  updateCollectionItemRequestSchema,
} from "./collection-item";

const validScryfallId = "b7c5c5e4-6b1a-4c1a-9c1a-8f2e6c1a0001";

describe("createCollectionItemRequestSchema", () => {
  it("defaults isProxy, binderLocation, and language", () => {
    const parsed = createCollectionItemRequestSchema.parse({
      scryfallId: validScryfallId,
      finish: "nonfoil",
      condition: "NM",
      quantity: 1,
    });
    expect(parsed).toMatchObject({ isProxy: false, binderLocation: "", language: "en" });
  });

  it("rejects a non-positive quantity", () => {
    expect(() =>
      createCollectionItemRequestSchema.parse({
        scryfallId: validScryfallId,
        finish: "nonfoil",
        condition: "NM",
        quantity: 0,
      }),
    ).toThrow();
  });
});

describe("updateCollectionItemRequestSchema", () => {
  it("accepts a partial patch", () => {
    const parsed = updateCollectionItemRequestSchema.parse({ quantity: 3 });
    expect(parsed).toEqual({ quantity: 3 });
  });

  it("rejects an empty patch", () => {
    expect(() => updateCollectionItemRequestSchema.parse({})).toThrow();
  });
});
