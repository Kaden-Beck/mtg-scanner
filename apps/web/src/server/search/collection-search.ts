import type { QueryNode } from "@mtg/query-parser";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { type CardRow, type CollectionItemRow, cards, collectionItems } from "../db/schema";
import { compileQuery } from "./compile";

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
