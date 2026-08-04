import { scryfallIdSchema } from "@mtg/schemas";
import { asc, eq } from "drizzle-orm";
import { listTagsForItems } from "../collection/tags";
import { db } from "../db/client";
import { cards, collectionItems } from "../db/schema";
import type { CollectionExportRow } from "./row-schema";

/**
 * The whole collection, ready to serialize.
 *
 * Tags come from a second query merged in memory rather than from a join: a
 * join would multiply each stack by its tag count, and collapsing that back
 * is more code than this.
 *
 * The ordering is load-bearing, not cosmetic. Exporting the same unchanged
 * collection twice must produce identical bytes, or diffing two exports -
 * the obvious thing to do with them - is useless.
 *
 * The tiebreaker is the stack's *natural* key (the columns of the unique
 * index), not `collection_items.id`. Name/set/number don't distinguish two
 * stacks of one printing, and `id` is a random UUID, so ordering by it is
 * stable within one database and meaningless between two - which makes a
 * round-tripped export compare unequal to its source for reasons that have
 * nothing to do with the data. The round-trip test caught exactly that.
 */
export function gatherExportRows(): CollectionExportRow[] {
  const stacks = db
    .select({ item: collectionItems, card: cards })
    .from(collectionItems)
    .innerJoin(cards, eq(collectionItems.scryfallId, cards.id))
    .orderBy(
      asc(cards.name),
      asc(cards.setCode),
      asc(cards.collectorNumber),
      asc(collectionItems.finish),
      asc(collectionItems.condition),
      asc(collectionItems.isProxy),
      asc(collectionItems.binderLocation),
      asc(collectionItems.language),
    )
    .all();

  const tagsByItem = listTagsForItems(stacks.map((stack) => stack.item.id));

  return stacks.map(({ item, card }) => ({
    scryfallId: scryfallIdSchema.parse(item.scryfallId),
    name: card.name,
    setCode: card.setCode,
    setName: card.setName,
    collectorNumber: card.collectorNumber,
    quantity: item.quantity,
    finish: item.finish,
    condition: item.condition,
    isProxy: item.isProxy,
    binderLocation: item.binderLocation,
    language: item.language,
    tags: tagsByItem.get(item.id) ?? [],
  }));
}
