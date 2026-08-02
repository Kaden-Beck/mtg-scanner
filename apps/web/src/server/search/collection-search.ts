import { parseQuery, type QueryNode } from "@mtg/query-parser";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { type CardRow, type CollectionItemRow, cards, collectionItems } from "../db/schema";
import { compileQuery } from "./compile";
import { type QueryErrorPresentation, toQueryErrorPresentation } from "./query-errors";

export interface CollectionSearchRow {
  readonly item: CollectionItemRow;
  readonly card: CardRow;
}

/**
 * Runs a compiled query against the collection - one row per owned stack,
 * joined to its printing.
 *
 * A `null` query means "no filter" rather than an empty result: the search
 * box starts blank, and `parseQuery` deliberately throws on empty input
 * rather than inventing an always-true AST node, so translating "blank" to
 * "everything" is this layer's job.
 */
export function searchCollection(query: QueryNode | null, limit = 200): CollectionSearchRow[] {
  return db
    .select({ item: collectionItems, card: cards })
    .from(collectionItems)
    .innerJoin(cards, eq(collectionItems.scryfallId, cards.id))
    .where(query === null ? undefined : compileQuery(query))
    .orderBy(asc(cards.name), asc(cards.setCode), asc(cards.collectorNumber))
    .limit(limit)
    .all();
}

export type CollectionSearchOutcome =
  | { readonly ok: true; readonly rows: readonly CollectionSearchRow[] }
  | { readonly ok: false; readonly error: QueryErrorPresentation };

/**
 * The whole raw-string-to-results path in one call: parse, compile, run,
 * and turn any query error into something renderable.
 *
 * This is what a UI should call. Keeping it here rather than inline in the
 * page means the search box's actual behaviour - including every failure
 * mode - is unit-testable, which an async Server Component isn't (ADR-007).
 *
 * A blank box is "no filter", not an error: `parseQuery` throws on empty
 * input by design, so translating blank into "show everything" happens
 * here, once, instead of at every call site.
 */
export function runCollectionSearch(rawQuery: string, limit = 200): CollectionSearchOutcome {
  const trimmed = rawQuery.trim();
  try {
    return { ok: true, rows: searchCollection(trimmed === "" ? null : parseQuery(trimmed), limit) };
  } catch (error) {
    const presentation = toQueryErrorPresentation(error);
    // Not a query error - a real fault. Never launder a bug into the
    // search box as though the user had mistyped.
    if (presentation === null) throw error;
    return { ok: false, error: presentation };
  }
}
