import { describe, expect, it } from "vitest";
import { isRejectedOcrText, parseCollectorNumber, sanitizeOcrText } from "./parse.ts";

describe("sanitizeOcrText", () => {
  it("collapses whitespace and strips punctuation noise", () => {
    expect(sanitizeOcrText("  FDN | U  0125  ")).toBe("FDN U 0125");
  });
});

describe("isRejectedOcrText", () => {
  it("rejects too-short and too-long strings", () => {
    expect(isRejectedOcrText("ab")).toBe(true);
    expect(isRejectedOcrText("x".repeat(31))).toBe(true);
  });

  it("rejects truncation markers and rules-text false positives", () => {
    expect(isRejectedOcrText("Sacri..")).toBe(true);
    expect(isRejectedOcrText("Sacrifice a creature")).toBe(true);
  });

  it("accepts a plausible collector strip", () => {
    expect(isRejectedOcrText("FDN U 0125")).toBe(false);
  });
});

describe("parseCollectorNumber", () => {
  it("parses SET rarity number", () => {
    expect(parseCollectorNumber("FDN U 0125")).toEqual({
      setCode: "fdn",
      collectorNumber: "0125",
      raw: "FDN U 0125",
    });
  });

  it("parses SET number without rarity", () => {
    expect(parseCollectorNumber("mh2 250")).toEqual({
      setCode: "mh2",
      collectorNumber: "250",
      raw: "mh2 250",
    });
  });

  it("parses number/total SET", () => {
    expect(parseCollectorNumber("168/264 DOM")).toEqual({
      setCode: "dom",
      collectorNumber: "168",
      raw: "168/264 DOM",
    });
  });

  it("returns number-only when set is missing", () => {
    expect(parseCollectorNumber("0125")).toEqual({
      setCode: null,
      collectorNumber: "0125",
      raw: "0125",
    });
  });

  it("returns nulls for rejected text", () => {
    expect(parseCollectorNumber("Destroy target")).toEqual({
      setCode: null,
      collectorNumber: null,
      raw: "Destroy target",
    });
  });
});
