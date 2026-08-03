import type { QueryErrorKind } from "@/server/search/query-errors";

/**
 * The pure half of the collection browse page. An async Server Component
 * can't be rendered by Vitest at all (ADR-007), so anything with a decision
 * in it - which image size, which view mode, what the error banner says -
 * lives here where it's directly testable, and `page.tsx` stays a dumb
 * arrangement of the results.
 */

export const VIEW_MODES = ["grid", "list"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/** What Next hands us per search param: absent, one value, or repeated. */
export type SearchParamValue = string | string[] | undefined;

/**
 * Collapses a possibly-repeated param to a single value. `?q=a&q=b` is
 * degenerate input (nothing in the UI produces it), so taking the first
 * beats erroring at the user about a URL they didn't type.
 */
export function firstParam(value: SearchParamValue): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? (value[0] ?? "") : value;
}

function isViewMode(value: string): value is ViewMode {
  return VIEW_MODES.some((mode) => mode === value);
}

/** Anything that isn't a known mode falls back to grid rather than erroring. */
export function parseViewMode(value: SearchParamValue): ViewMode {
  const raw = firstParam(value);
  return isViewMode(raw) ? raw : "grid";
}

/** Builds a link to this page preserving the other control's state. */
export function collectionHref(query: string, view: ViewMode): string {
  const params = new URLSearchParams();
  if (query !== "") params.set("q", query);
  if (view !== "grid") params.set("view", view);
  const search = params.toString();
  return search === "" ? "/collection" : `/collection?${search}`;
}

// Deliberately excludes `art_crop` and `border_crop`: both cut the card's
// bottom edge, which is exactly where Wizards puts the artist credit and
// copyright line. The provider requirement (KAD-19 AC4) is that those stay
// legible, so the crops are not fallbacks - they're never eligible.
const GRID_IMAGE_PREFERENCE = ["normal", "large", "png", "small"] as const;
const LIST_IMAGE_PREFERENCE = ["small", "normal", "large", "png"] as const;

/**
 * Picks the largest uncropped image the printing actually has, at a size
 * suited to the view. Returns `null` when the printing has no full-card
 * image (double-faced layouts carry theirs per-face in `card_faces`).
 */
export function cardImageUrl(
  imageUris: Record<string, string> | null,
  view: ViewMode,
): string | null {
  if (imageUris === null) return null;
  const preference = view === "grid" ? GRID_IMAGE_PREFERENCE : LIST_IMAGE_PREFERENCE;
  for (const key of preference) {
    const url = imageUris[key];
    if (url !== undefined && url !== "") return url;
  }
  return null;
}

/**
 * Headline for the error banner. The body is the parser's own message,
 * which already names the offending operator or token - this only sets the
 * user's expectation about whether it's fixable by retyping (KAD-18).
 */
export function errorHeading(kind: QueryErrorKind): string {
  switch (kind) {
    case "unsupported-operator":
      return "Unknown search operator";
    case "unimplemented-operator":
      return "That operator isn't wired up yet";
    case "syntax":
      return "Couldn't read that search";
  }
}

/**
 * One line describing the result set. Says so explicitly when the result
 * count is exactly the cap, since "200 cards" would otherwise read as a
 * complete answer when it's a truncated one.
 */
export function resultSummary(count: number, limit: number): string {
  if (count === 0) return "No cards match.";
  if (count >= limit) {
    return `Showing the first ${String(limit)} matches - narrow the search to see more.`;
  }
  return `${String(count)} ${count === 1 ? "card" : "cards"}`;
}
