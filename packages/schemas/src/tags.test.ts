import { describe, expect, it } from "vitest";
import { MAX_TAG_LENGTH, normalizeTag } from "./tags";

describe("normalizeTag", () => {
  it.each([
    ["already canonical", "cube", "cube"],
    ["mixed case", "Cube", "cube"],
    ["shouting", "CUBE", "cube"],
    ["surrounding whitespace", "  cube  ", "cube"],
    ["tab and newline", "\tcube\n", "cube"],
    ["internal whitespace run", "edh    staple", "edh staple"],
    ["all of the above", "  EDH\t\tSTAPLE ", "edh staple"],
  ])("%s", (_label, input, expected) => {
    expect(normalizeTag(input)).toBe(expected);
  });

  // The point of returning null rather than "" : an empty tag would be
  // invisible in the UI and there would be no chip to click to remove it.
  it.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["only whitespace characters", "\t\n\r "],
  ])("returns null for %s input", (_label, input) => {
    expect(normalizeTag(input)).toBeNull();
  });

  it("accepts a tag exactly at the length limit", () => {
    expect(normalizeTag("a".repeat(MAX_TAG_LENGTH))).toHaveLength(MAX_TAG_LENGTH);
  });

  it("rejects a tag past the length limit", () => {
    expect(normalizeTag("a".repeat(MAX_TAG_LENGTH + 1))).toBeNull();
  });

  // The length bound applies to the normalized form, so trailing spaces
  // don't push an otherwise-fine tag over the edge.
  it("measures length after trimming", () => {
    expect(normalizeTag(`  ${"a".repeat(MAX_TAG_LENGTH)}  `)).toHaveLength(MAX_TAG_LENGTH);
  });

  it("is idempotent", () => {
    for (const raw of ["Cube", "  EDH  STAPLE ", "burn"]) {
      const once = normalizeTag(raw);
      expect(once).not.toBeNull();
      if (once !== null) expect(normalizeTag(once)).toBe(once);
    }
  });

  // Free-form means free-form: punctuation and non-ASCII are tags too.
  it("leaves punctuation and non-ASCII alone", () => {
    expect(normalizeTag("Pauper-EDH")).toBe("pauper-edh");
    expect(normalizeTag("Café")).toBe("café");
  });
});
