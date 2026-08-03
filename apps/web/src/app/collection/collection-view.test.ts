import { describe, expect, it } from "vitest";
import type { QueryErrorKind } from "@/server/search/query-errors";
import {
  binderConflictMessage,
  binderFieldLabel,
  binderFilterTerm,
  cardImageUrl,
  collectionHref,
  errorHeading,
  firstParam,
  isTermActive,
  parseViewMode,
  resultSummary,
  splitQueryTerms,
  toggleQueryTerm,
  VIEW_MODES,
  type ViewMode,
} from "./collection-view";

describe("firstParam", () => {
  it.each([
    ["absent", undefined, ""],
    ["single", "c:r", "c:r"],
    ["repeated", ["c:r", "c:g"], "c:r"],
    ["empty array", [], ""],
  ])("%s", (_label, input, expected) => {
    expect(firstParam(input)).toBe(expected);
  });
});

describe("parseViewMode", () => {
  it.each([
    ["absent defaults to grid", undefined, "grid"],
    ["grid", "grid", "grid"],
    ["list", "list", "list"],
    ["unknown falls back to grid", "carousel", "grid"],
    ["empty falls back to grid", "", "grid"],
  ])("%s", (_label, input, expected) => {
    expect(parseViewMode(input)).toBe(expected);
  });
});

describe("collectionHref", () => {
  it("omits both params at their defaults", () => {
    expect(collectionHref("", "grid")).toBe("/collection");
  });

  it("keeps the query when switching view", () => {
    expect(collectionHref("c:r", "list")).toBe("/collection?q=c%3Ar&view=list");
  });

  it("omits the default view but keeps the query", () => {
    expect(collectionHref("t:creature", "grid")).toBe("/collection?q=t%3Acreature");
  });

  it("escapes characters that are meaningful in a query string", () => {
    expect(collectionHref('o:"draw a card" -is:reserved', "grid")).toBe(
      "/collection?q=o%3A%22draw+a+card%22+-is%3Areserved",
    );
  });
});

describe("collectionHref extras", () => {
  it("carries a transient param alongside the controls", () => {
    expect(collectionHref("c:r", "list", { conflict: "abc" })).toBe(
      "/collection?q=c%3Ar&view=list&conflict=abc",
    );
  });

  it("drops an empty extra rather than emitting a bare key", () => {
    expect(collectionHref("", "grid", { conflictTo: "" })).toBe("/collection");
  });

  // Every server-action redirect goes through here, so the path being fixed
  // is what rules out an open redirect - not a check at the call site.
  it("always produces a /collection path regardless of input", () => {
    expect(collectionHref("https://evil.example/", "grid")).toMatch(/^\/collection\?/);
  });
});

describe("splitQueryTerms", () => {
  it("splits on whitespace", () => {
    expect(splitQueryTerms("c:r t:creature cmc<=3")).toEqual(["c:r", "t:creature", "cmc<=3"]);
  });

  it("collapses runs of whitespace and ignores leading/trailing space", () => {
    expect(splitQueryTerms("  c:r \t\n t:goblin  ")).toEqual(["c:r", "t:goblin"]);
  });

  // The reason this exists at all: a naive split would tear `binder:"box
  // one"` in half, so toggling an unrelated chip would corrupt the query.
  it("keeps a quoted value with spaces as one term, quotes included", () => {
    expect(splitQueryTerms('binder:"box one" c:r')).toEqual(['binder:"box one"', "c:r"]);
  });

  it("returns nothing for an empty query", () => {
    expect(splitQueryTerms("")).toEqual([]);
    expect(splitQueryTerms("   ")).toEqual([]);
  });
});

describe("binderFilterTerm", () => {
  it("builds a bare term for a simple location", () => {
    expect(binderFilterTerm("box1")).toBe("binder:box1");
  });

  it("quotes a location containing whitespace or parens", () => {
    expect(binderFilterTerm("box one")).toBe('binder:"box one"');
    expect(binderFilterTerm("shelf (top)")).toBe('binder:"shelf (top)"');
  });

  // The tokenizer treats `"` as a mode toggle with no escape, so there is no
  // query text that selects such a location - saying so beats emitting a
  // term that would filter to something else.
  it("returns null for a location that has no query spelling", () => {
    expect(binderFilterTerm('the "good" binder')).toBeNull();
  });

  it("returns null for the empty location", () => {
    expect(binderFilterTerm("")).toBeNull();
  });
});

describe("toggleQueryTerm", () => {
  it("appends a term that is not present", () => {
    expect(toggleQueryTerm("c:r", "binder:box1")).toBe("c:r binder:box1");
  });

  it("appends to an empty query without a leading space", () => {
    expect(toggleQueryTerm("", "binder:box1")).toBe("binder:box1");
  });

  it("removes a term that is already present", () => {
    expect(toggleQueryTerm("c:r binder:box1 t:goblin", "binder:box1")).toBe("c:r t:goblin");
  });

  it("removes only the first of a duplicated term", () => {
    expect(toggleQueryTerm("binder:box1 binder:box1", "binder:box1")).toBe("binder:box1");
  });

  it("leaves a quoted term intact when toggling a different one", () => {
    expect(toggleQueryTerm('binder:"box one" c:r', "binder:box2")).toBe(
      'binder:"box one" c:r binder:box2',
    );
  });

  it("round-trips: toggling the same term twice restores the terms", () => {
    const query = 'c:r binder:"box one"';
    const term = "binder:box2";
    expect(splitQueryTerms(toggleQueryTerm(toggleQueryTerm(query, term), term))).toEqual(
      splitQueryTerms(query),
    );
  });
});

describe("isTermActive", () => {
  it("matches a whole term, not a substring of one", () => {
    expect(isTermActive("binder:box10", "binder:box1")).toBe(false);
    expect(isTermActive("c:r binder:box1", "binder:box1")).toBe(true);
  });
});

describe("binderFieldLabel", () => {
  const stack = { finish: "nonfoil", condition: "NM", isProxy: false, binderLocation: "box1" };

  it("names the card and the stack's location", () => {
    expect(binderFieldLabel("Forest", stack)).toBe(
      "Binder location for Forest (nonfoil, NM, box1)",
    );
  });

  it("calls an empty location unfiled rather than leaving a gap", () => {
    expect(binderFieldLabel("Forest", { ...stack, binderLocation: "" })).toContain("unfiled");
  });

  it("marks a proxy stack", () => {
    expect(binderFieldLabel("Forest", { ...stack, isProxy: true })).toContain("proxy");
  });

  // The whole point: several stacks of one printing can share a page, and
  // inputs that share an accessible name are ambiguous to a screen reader
  // and to a test locator alike.
  it("distinguishes stacks of the same card that differ in any identity column", () => {
    const labels = new Set([
      binderFieldLabel("Forest", stack),
      binderFieldLabel("Forest", { ...stack, condition: "LP" }),
      binderFieldLabel("Forest", { ...stack, finish: "foil" }),
      binderFieldLabel("Forest", { ...stack, isProxy: true }),
      binderFieldLabel("Forest", { ...stack, binderLocation: "box2" }),
    ]);
    expect(labels.size).toBe(5);
  });
});

describe("binderConflictMessage", () => {
  it("names the card when the conflicting stack is on the page", () => {
    const message = binderConflictMessage("Lightning Bolt", "box1");
    expect(message).toContain("Lightning Bolt");
    expect(message).toContain('"box1"');
  });

  it("falls back to a generic subject when the stack is not in view", () => {
    expect(binderConflictMessage(null, "box1")).toContain("That stack");
  });

  // An empty location is "unset", not a location named "" - the message has
  // to read as English either way.
  it("describes the empty location in words", () => {
    expect(binderConflictMessage(null, "")).toContain("no binder location");
  });

  it("says the edit did not apply rather than implying a merge", () => {
    expect(binderConflictMessage(null, "box1")).toContain("wasn't moved");
  });
});

describe("cardImageUrl", () => {
  it("returns null when the printing has no images", () => {
    expect(cardImageUrl(null, "grid")).toBeNull();
  });

  it("returns null when no eligible size is present", () => {
    expect(cardImageUrl({ art_crop: "https://img/art" }, "grid")).toBeNull();
  });

  it("prefers a larger uncropped image in grid view", () => {
    const uris = { small: "https://img/s", normal: "https://img/n", large: "https://img/l" };
    expect(cardImageUrl(uris, "grid")).toBe("https://img/n");
  });

  it("prefers the small image in list view", () => {
    const uris = { small: "https://img/s", normal: "https://img/n" };
    expect(cardImageUrl(uris, "list")).toBe("https://img/s");
  });

  it("falls through to the next size when the preferred one is missing", () => {
    expect(cardImageUrl({ png: "https://img/p" }, "grid")).toBe("https://img/p");
    expect(cardImageUrl({ normal: "https://img/n" }, "list")).toBe("https://img/n");
  });

  // AC4: the artist credit and copyright line sit on the card's bottom
  // edge, which both Scryfall crops cut off. Picking one would violate the
  // provider requirement even though it is a perfectly valid image URL.
  it.each(VIEW_MODES)("never picks a cropped image in %s view", (view) => {
    const uris = {
      art_crop: "https://img/art",
      border_crop: "https://img/border",
      normal: "https://img/n",
    };
    expect(cardImageUrl(uris, view)).toBe("https://img/n");
  });

  it("ignores an empty-string url and keeps looking", () => {
    expect(cardImageUrl({ normal: "", large: "https://img/l" }, "grid")).toBe("https://img/l");
  });
});

describe("errorHeading", () => {
  const kinds: QueryErrorKind[] = ["unsupported-operator", "unimplemented-operator", "syntax"];

  it.each(kinds)("returns a distinct heading for %s", (kind) => {
    expect(errorHeading(kind)).not.toBe("");
  });

  it("gives every kind its own heading", () => {
    expect(new Set(kinds.map(errorHeading)).size).toBe(kinds.length);
  });
});

describe("resultSummary", () => {
  it("reports an empty result", () => {
    expect(resultSummary(0, 200)).toBe("No cards match.");
  });

  it("uses the singular for one card", () => {
    expect(resultSummary(1, 200)).toBe("1 card");
  });

  it("uses the plural for several", () => {
    expect(resultSummary(12, 200)).toBe("12 cards");
  });

  // A bare "200 cards" would read as the complete answer when it is in fact
  // a truncated one.
  it("says so when the result set is capped", () => {
    expect(resultSummary(200, 200)).toBe(
      "Showing the first 200 matches - narrow the search to see more.",
    );
  });
});

describe("view mode round-trip", () => {
  it.each(VIEW_MODES)("%s survives href -> parse", (view: ViewMode) => {
    const href = collectionHref("c:r", view);
    const parsed = new URL(href, "http://localhost").searchParams.get("view") ?? undefined;
    expect(parseViewMode(parsed)).toBe(view);
  });
});
