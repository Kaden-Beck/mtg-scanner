import { describe, expect, it } from "vitest";
import type { QueryErrorKind } from "@/server/search/query-errors";
import {
  cardImageUrl,
  collectionHref,
  errorHeading,
  firstParam,
  parseViewMode,
  resultSummary,
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
