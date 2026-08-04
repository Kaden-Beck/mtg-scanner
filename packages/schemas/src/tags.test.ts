import { describe, expect, it } from "vitest";
import { deserializeTags, MAX_TAG_LENGTH, normalizeTag, serializeTags } from "./tags";

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

describe("serializeTags / deserializeTags", () => {
  it("packs and unpacks a plain list", () => {
    expect(serializeTags(["burn", "cube"])).toBe("burn;cube");
    expect(deserializeTags("burn;cube")).toEqual(["burn", "cube"]);
  });

  it("produces an empty cell for no tags, and no tags from an empty cell", () => {
    expect(serializeTags([])).toBe("");
    expect(deserializeTags("")).toEqual([]);
  });

  // The escaping is the whole reason this pair exists rather than a bare
  // `.join(";")`: tags are free-form, so a tag containing the separator has
  // to survive rather than being silently split into two.
  it("round-trips a tag containing the separator", () => {
    const packed = serializeTags(["a;b", "c"]);
    expect(packed).toBe("a\\;b;c");
    expect(deserializeTags(packed)).toEqual(["a;b", "c"]);
  });

  it("round-trips a tag containing a backslash", () => {
    const packed = serializeTags(["back\\slash"]);
    expect(deserializeTags(packed)).toEqual(["back\\slash"]);
  });

  it("round-trips a tag that is nothing but escape characters", () => {
    expect(deserializeTags(serializeTags([";\\"]))).toEqual([";\\"]);
  });

  it.each([
    ["simple", ["burn", "cube", "edh staple"]],
    ["separator-heavy", ["a;b", ";", "c;;d"]],
    ["backslash-heavy", ["\\", "a\\b", "\\\\"]],
    ["mixed", ["a;b", "back\\slash", "edh staple"]],
  ])("round-trips %s tag sets", (_label, tags) => {
    expect(deserializeTags(serializeTags(tags))).toEqual([...tags].sort());
  });

  // A hand-edited or third-party CSV must not be able to introduce a tag the
  // write path would never have created.
  it("normalizes and de-duplicates on the way back in", () => {
    expect(deserializeTags("Cube; CUBE ;  ;burn")).toEqual(["burn", "cube"]);
  });

  it("treats a trailing lone backslash as a literal rather than losing the tag", () => {
    expect(deserializeTags("cube\\")).toEqual(["cube\\"]);
  });
});
