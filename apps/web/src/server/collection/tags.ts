import { normalizeTag } from "@mtg/schemas";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { collectionItems, collectionItemTags } from "../db/schema";

export type AddTagResult =
  | { outcome: "added"; tag: string }
  | { outcome: "already_present"; tag: string }
  | { outcome: "invalid" }
  | { outcome: "not_found" };

/**
 * Tags one stack (KAD-22). The tag is normalized first, so `Cube` and
 * ` cube ` land on the same row rather than two that look identical.
 *
 * Existence of the stack is checked before the insert rather than relying
 * on the foreign key to reject it: a `FOREIGN KEY constraint failed` is
 * indistinguishable at the catch site from a real bug, and the caller needs
 * to tell the two apart.
 */
export function addTag(collectionItemId: string, rawTag: string): AddTagResult {
  const tag = normalizeTag(rawTag);
  if (tag === null) return { outcome: "invalid" };

  const stack = db
    .select({ id: collectionItems.id })
    .from(collectionItems)
    .where(eq(collectionItems.id, collectionItemId))
    .get();
  if (!stack) return { outcome: "not_found" };

  const existing = db
    .select({ tag: collectionItemTags.tag })
    .from(collectionItemTags)
    .where(
      and(
        eq(collectionItemTags.collectionItemId, collectionItemId),
        eq(collectionItemTags.tag, tag),
      ),
    )
    .get();
  if (existing) return { outcome: "already_present", tag };

  db.insert(collectionItemTags).values({ collectionItemId, tag, createdAt: new Date() }).run();
  return { outcome: "added", tag };
}

/**
 * Untags one stack. Returns whether a row was actually removed, so a
 * caller can tell "removed it" from "it wasn't there" - the tag arrives
 * from a form field and may be stale by the time it's submitted.
 */
export function removeTag(collectionItemId: string, rawTag: string): boolean {
  const tag = normalizeTag(rawTag);
  if (tag === null) return false;

  const result = db
    .delete(collectionItemTags)
    .where(
      and(
        eq(collectionItemTags.collectionItemId, collectionItemId),
        eq(collectionItemTags.tag, tag),
      ),
    )
    .run();
  return result.changes > 0;
}

/** Every tag on one stack, alphabetically. */
export function listTagsForItem(collectionItemId: string): string[] {
  return db
    .select({ tag: collectionItemTags.tag })
    .from(collectionItemTags)
    .where(eq(collectionItemTags.collectionItemId, collectionItemId))
    .orderBy(asc(collectionItemTags.tag))
    .all()
    .map((row) => row.tag);
}

/**
 * Tags for a page of stacks, in one query.
 *
 * The browse page renders up to 200 stacks; asking per stack would be 200
 * round trips to decorate one screen. Returns a Map so a caller can look up
 * a stack that has no tags without special-casing `undefined` at the call
 * site - it just gets an empty array via `?? []`.
 */
export function listTagsForItems(collectionItemIds: readonly string[]): Map<string, string[]> {
  const byItem = new Map<string, string[]>();
  if (collectionItemIds.length === 0) return byItem;

  const rows = db
    .select()
    .from(collectionItemTags)
    .where(inArray(collectionItemTags.collectionItemId, [...collectionItemIds]))
    .orderBy(asc(collectionItemTags.tag))
    .all();

  for (const row of rows) {
    const existing = byItem.get(row.collectionItemId);
    if (existing) existing.push(row.tag);
    else byItem.set(row.collectionItemId, [row.tag]);
  }
  return byItem;
}

export interface TagFacet {
  readonly tag: string;
  readonly stackCount: number;
}

/**
 * Cap on how many tags the facet offers. Tags are free-form with no
 * vocabulary table, so there is no bound on how many a collection can
 * accumulate; the page says so when it hits this rather than presenting a
 * truncated list as the whole set.
 */
export const TAG_FACET_LIMIT = 50;

/**
 * The tags in use with the number of stacks carrying each, for the tag
 * filter. Alphabetical rather than by count, matching the binder facet -
 * a chip row that reorders itself as counts change is hard to aim at.
 */
export function listTags(limit = TAG_FACET_LIMIT): TagFacet[] {
  return db
    .select({ tag: collectionItemTags.tag, stackCount: count() })
    .from(collectionItemTags)
    .groupBy(collectionItemTags.tag)
    .orderBy(asc(collectionItemTags.tag))
    .limit(limit)
    .all();
}
