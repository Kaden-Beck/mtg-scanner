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

/**
 * Builds a link to this page preserving the other control's state. `extra`
 * carries transient params (the binder conflict notice) that aren't part of
 * the page's own controls.
 *
 * Every redirect out of a server action goes through here, so the path is
 * always `/collection` by construction - the action never redirects to a
 * URL the client supplied.
 */
export function collectionHref(
  query: string,
  view: ViewMode,
  extra: Readonly<Record<string, string>> = {},
): string {
  const params = new URLSearchParams();
  if (query !== "") params.set("q", query);
  if (view !== "grid") params.set("view", view);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== "") params.set(key, value);
  }
  const search = params.toString();
  return search === "" ? "/collection" : `/collection?${search}`;
}

/**
 * Splits a query into whitespace-separated terms, treating whitespace inside
 * double quotes as ordinary text - the same rule the tokenizer's `scanTerm`
 * uses, so `binder:"box one"` stays one term instead of being torn in half
 * by a facet toggle that has nothing to do with it.
 *
 * This is deliberately not a re-implementation of the tokenizer: it only has
 * to slice the raw text into the same units the user typed, so that
 * appending or removing one leaves the rest byte-identical. Parens glued to
 * a term stay glued; that just means a chip inside a parenthesized group
 * won't be recognized as active, and toggling it appends instead.
 */
export function splitQueryTerms(query: string): string[] {
  const terms: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of query) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (!inQuotes && (char === " " || char === "\t" || char === "\n" || char === "\r")) {
      if (current !== "") terms.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current !== "") terms.push(current);

  return terms;
}

/**
 * The `<operator>:<value>` term that selects exactly `value`, or `null` when
 * the value can't be expressed as one: the tokenizer treats `"` as a mode
 * toggle with no escape, so a value containing a quote has no query spelling
 * at all. Returning null lets a facet render such a value as plain text
 * rather than a link that would silently filter to the wrong thing.
 *
 * Shared by the binder-location and tag facets (KAD-21, KAD-22) - the
 * quoting rule belongs to the query grammar, not to either facet.
 */
export function filterTerm(operator: string, value: string): string | null {
  if (value === "" || value.includes('"')) return null;
  const needsQuotes = /[\s()]/.test(value);
  return needsQuotes ? `${operator}:"${value}"` : `${operator}:${value}`;
}

/** Whether `term` is already one of the query's top-level terms. */
export function isTermActive(query: string, term: string): boolean {
  return splitQueryTerms(query).includes(term);
}

/**
 * Adds `term` to the query, or removes it if it's already there. Facet chips
 * compose into the one query string the search box owns (KAD-21) rather than
 * being a second, parallel filter the user has to reconcile with what they
 * typed.
 */
export function toggleQueryTerm(query: string, term: string): string {
  const terms = splitQueryTerms(query);
  const index = terms.indexOf(term);
  if (index === -1) return [...terms, term].join(" ");
  return [...terms.slice(0, index), ...terms.slice(index + 1)].join(" ");
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
    case "syntax":
      return "Couldn't read that search";
  }
}

/** The stack-identity fields the binder field's label needs to name. */
export interface StackIdentity {
  readonly finish: string;
  readonly condition: string;
  readonly isProxy: boolean;
  readonly binderLocation: string;
}

/**
 * Accessible name for a stack's binder-location input.
 *
 * The card name alone isn't enough: the same printing can legitimately
 * appear as several stacks on one page (different condition, finish, or
 * location - that's what the stack unique index means), and several inputs
 * sharing one accessible name is ambiguous both to a screen reader and to a
 * test locator. Naming the identity columns distinguishes them.
 */
export function binderFieldLabel(cardName: string, stack: StackIdentity): string {
  const parts = [stack.finish, stack.condition];
  if (stack.isProxy) parts.push("proxy");
  parts.push(stack.binderLocation === "" ? "unfiled" : stack.binderLocation);
  return `Binder location for ${cardName} (${parts.join(", ")})`;
}

/**
 * What the user sees when a binder-location edit collided with an existing
 * stack. `binderLocation` is part of the stack unique index, so moving a
 * stack somewhere an identical stack already sits is a real collision, and
 * `updateCollectionItem` refuses it rather than merging (combining the two
 * quantities is a decision the user never made). The message has to say that
 * out loud - a silently discarded edit is the worse failure.
 *
 * `cardName` is null when the conflicting stack isn't in the current result
 * set, e.g. the search that produced the page no longer matches it.
 */
export function binderConflictMessage(cardName: string | null, location: string): string {
  const subject = cardName === null ? "That stack" : `Your ${cardName} stack`;
  const target = location === "" ? "no binder location" : `"${location}"`;
  return `${subject} wasn't moved: an identical stack already sits in ${target}. Move or merge that one first - combining two physical stacks isn't something this will do on its own.`;
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
