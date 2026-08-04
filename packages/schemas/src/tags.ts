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

/**
 * Separator for a tag list packed into a single CSV cell (KAD-23). Tags may
 * contain spaces, so a space-separated list is out; `;` reads naturally and
 * is rare inside a tag.
 */
const TAG_SEPARATOR = ";";

/**
 * Packs tags into one cell, backslash-escaping the separator and the escape
 * character itself.
 *
 * The escaping is what makes the CSV export genuinely lossless rather than
 * lossless-unless-you-used-a-semicolon. Tags are free-form: forbidding `;`
 * to avoid the problem would be a real restriction on the user to save six
 * lines of code here.
 */
export function serializeTags(tags: readonly string[]): string {
  return tags.map((tag) => tag.replace(/\\/g, "\\\\").replace(/;/g, "\\;")).join(TAG_SEPARATOR);
}

/**
 * The inverse of `serializeTags`. Every element is put back through
 * `normalizeTag` and anything that doesn't survive is dropped, so a
 * hand-edited or third-party CSV can't introduce a tag that the write path
 * would never have created.
 */
export function deserializeTags(raw: string): string[] {
  const tags: string[] = [];
  let current = "";
  let escaped = false;

  for (const char of raw) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === TAG_SEPARATOR) {
      tags.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  // A trailing lone backslash is malformed input; treating it as a literal
  // beats dropping the tag it was attached to.
  if (escaped) current += "\\";
  tags.push(current);

  const normalized = tags
    .map((tag) => normalizeTag(tag))
    .filter((tag): tag is string => tag !== null);
  return [...new Set(normalized)].sort();
}
