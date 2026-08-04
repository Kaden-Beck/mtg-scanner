import { eq } from "drizzle-orm";
import { createOrMergeCollectionItem } from "../collection/items";
import { addTag } from "../collection/tags";
import { db } from "../db/client";
import { cards } from "../db/schema";
import { parseJson } from "../export/json";
import type { CollectionExportRow } from "../export/row-schema";

export interface SkippedExportRow {
  readonly scryfallId: string;
  readonly name: string;
  readonly reason: "printing_not_found";
}

export type ImportCollectionJsonResult =
  | {
      readonly outcome: "completed";
      readonly imported: number;
      readonly skipped: readonly SkippedExportRow[];
    }
  | { readonly outcome: "invalid"; readonly message: string };

/**
 * Re-imports this app's own JSON export (KAD-23 AC2).
 *
 * Deliberately *not* routed through the Archidekt importer's machinery.
 * That pipeline exists to cope with a third-party file: fuzzy column
 * aliases, printing resolution from name + set + number, a reconciliation
 * queue for what it can't pin down, and file-hash duplicate detection. None
 * of that applies here. Every row already names an exact `scryfall_id`, so
 * a row either matches a printing or it doesn't, and there is nothing for a
 * human to reconcile - the honest report is a count and a list.
 *
 * Writes go through `createOrMergeCollectionItem`, so importing into a
 * database that already holds some of these stacks *adds* to them rather
 * than replacing them. That is the same merge semantics the CSV import has,
 * and it is why the round-trip test imports into a fresh database: "the
 * result is lossless" is a statement about an empty target, not about
 * arbitrary pre-existing state.
 */
export function importCollectionJson(text: string): ImportCollectionJsonResult {
  const parsed = parseJson(text);
  if (!parsed.ok) return { outcome: "invalid", message: parsed.message };

  const skipped: SkippedExportRow[] = [];
  let imported = 0;

  for (const row of parsed.file.items) {
    if (!printingExists(row)) {
      // Never silently dropped - the same principle as the CSV importer's
      // reconciliation queue, minus the queue, since there is no ambiguity
      // for a human to resolve.
      skipped.push({ scryfallId: row.scryfallId, name: row.name, reason: "printing_not_found" });
      continue;
    }

    const item = createOrMergeCollectionItem({
      scryfallId: row.scryfallId,
      finish: row.finish,
      condition: row.condition,
      quantity: row.quantity,
      isProxy: row.isProxy,
      binderLocation: row.binderLocation,
      language: row.language,
    });
    // After the stack exists: `collection_item_tags` has a foreign key to it.
    for (const tag of row.tags) addTag(item.id, tag);
    imported++;
  }

  return { outcome: "completed", imported, skipped };
}

function printingExists(row: CollectionExportRow): boolean {
  return (
    db.select({ id: cards.id }).from(cards).where(eq(cards.id, row.scryfallId)).get() !== undefined
  );
}
