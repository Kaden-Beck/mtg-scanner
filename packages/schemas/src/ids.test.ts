import { describe, expect, expectTypeOf, it } from "vitest";
import { type OracleId, oracleIdSchema, type ScryfallId, scryfallIdSchema } from "./ids";

const validUuid = "b7c5c5e4-6b1a-4c1a-9c1a-8f2e6c1a0001";

describe("branded ids", () => {
  it("parses a valid UUID into a ScryfallId", () => {
    const id = scryfallIdSchema.parse(validUuid);
    expect(id).toBe(validUuid);
  });

  it("rejects a non-UUID string", () => {
    expect(() => scryfallIdSchema.parse("not-a-uuid")).toThrow();
  });

  it("brands are distinct at the type level, not just structurally equal", () => {
    const scryfallId = scryfallIdSchema.parse(validUuid);
    const oracleId = oracleIdSchema.parse(validUuid);

    expectTypeOf(scryfallId).toEqualTypeOf<ScryfallId>();
    expectTypeOf(scryfallId).not.toEqualTypeOf<OracleId>();
    expectTypeOf(oracleId).not.toEqualTypeOf<ScryfallId>();

    // A raw string does not satisfy a branded id - it must be parsed.
    expectTypeOf<string>().not.toEqualTypeOf<ScryfallId>();
  });
});
