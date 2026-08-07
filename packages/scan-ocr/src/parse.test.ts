import { describe, expect, it } from "vitest";
import {
  isRejectedOcrText,
  parseCollectorNumber,
  sanitizeCardName,
  sanitizeOcrText,
} from "./parse.ts";

describe("sanitizeOcrText", () => {
  it("collapses whitespace and strips punctuation noise", () => {
    expect(sanitizeOcrText("  FDN | U  0125  ")).toBe("FDN U 0125");
  });
});

describe("isRejectedOcrText", () => {
  it("rejects too-short and too-long strings", () => {
    expect(isRejectedOcrText("ab")).toBe(true);
    expect(isRejectedOcrText("x".repeat(41))).toBe(true);
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

  it("parses modern two-line strip noise (rarity, EN, artist)", () => {
    expect(parseCollectorNumber("C 0041 SOS EN Erin Fong")).toEqual({
      setCode: "sos",
      collectorNumber: "0041",
      raw: "C 0041 SOS EN Erin Fong",
    });
  });

  it("ignores language codes as set codes", () => {
    expect(parseCollectorNumber("0041 EN")).toEqual({
      setCode: null,
      collectorNumber: "0041",
      raw: "0041 EN",
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

describe("sanitizeCardName", () => {
  it("keeps a plausible title", () => {
    expect(sanitizeCardName("  Chase Inspiration  ")).toBe("Chase Inspiration");
  });

  it("rejects pure digits", () => {
    expect(sanitizeCardName("0041")).toBeNull();
  });
});
