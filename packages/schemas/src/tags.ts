/**
 * Free-form collection tags (KAD-22). There is no vocabulary table and no
 * fixed set of values - the acceptance criterion is explicitly free-form
 * creation - so *normalization* is the only thing standing between the user
 * and two tags that render identically but never match each other.
 *
 * This lives in `packages/schemas` rather than next to the write path
 * because it has to be applied in three places that must agree exactly:
 * writing a tag, compiling a `tag:` query value, and reading tags back out
 * of an import. Two implementations of "lowercase and trim" is one more
 * than can be kept in sync.
 */

/** Longest tag we'll store. Generous; the point is to have a bound at all. */
export const MAX_TAG_LENGTH = 64;

/**
 * The canonical form of a tag, or `null` if the input isn't a tag at all.
 *
 * Trims, lowercases, and collapses internal whitespace runs, so `Cube`,
 * `cube ` and `CUBE` are one tag. Returns `null` for input that normalizes
 * to nothing (or is too long) rather than throwing or storing a blank:
 * callers have to decide what an unusable tag means in their context, and a
 * silently-stored empty tag would be invisible and unremovable in the UI.
 */
export function normalizeTag(raw: string): string | null {
  const normalized = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (normalized === "" || normalized.length > MAX_TAG_LENGTH) return null;
  return normalized;
}
