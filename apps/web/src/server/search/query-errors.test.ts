import {
  parseQuery,
  QueryParseError,
  QuerySyntaxError,
  SUPPORTED_OPERATORS,
  UnsupportedOperatorError,
} from "@mtg/query-parser";
import { describe, expect, it } from "vitest";
import { toQueryErrorPresentation } from "./query-errors";

describe("toQueryErrorPresentation", () => {
  it("names the unsupported operator and lists what is supported (AC2)", () => {
    // The whole point of KAD-18: the user must be told *which* operator
    // failed, not handed a generic "invalid search".
    let thrown: unknown;
    try {
      parseQuery("power:3");
    } catch (error) {
      thrown = error;
    }

    const presented = toQueryErrorPresentation(thrown);
    expect(presented).not.toBeNull();
    expect(presented?.kind).toBe("unsupported-operator");
    expect(presented?.operator).toBe("power");
    expect(presented?.message).toContain('"power:"');
    for (const operator of SUPPORTED_OPERATORS) {
      expect(presented?.message).toContain(operator);
    }
  });

  it("passes a syntax error's own message through with no operator attached", () => {
    const presented = toQueryErrorPresentation(new QuerySyntaxError("Unclosed '(' at position 0."));
    expect(presented).toEqual({
      kind: "syntax",
      message: "Unclosed '(' at position 0.",
      operator: null,
    });
  });

  it("handles a bare QueryParseError subclass it doesn't know about", () => {
    class FutureQueryError extends QueryParseError {}
    expect(toQueryErrorPresentation(new FutureQueryError("something new"))?.kind).toBe("syntax");
  });

  it("returns null for anything that isn't a query error, so real bugs stay bugs", () => {
    // A TypeError from a genuine fault must not be rendered next to the
    // search box as though the user had mistyped.
    expect(toQueryErrorPresentation(new TypeError("cannot read property of undefined"))).toBeNull();
    expect(toQueryErrorPresentation(new Error("boom"))).toBeNull();
    expect(toQueryErrorPresentation("not an error at all")).toBeNull();
    expect(toQueryErrorPresentation(undefined)).toBeNull();
  });

  it("keeps the operator key that UnsupportedOperatorError carries", () => {
    const presented = toQueryErrorPresentation(new UnsupportedOperatorError("artist"));
    expect(presented?.operator).toBe("artist");
  });
});
