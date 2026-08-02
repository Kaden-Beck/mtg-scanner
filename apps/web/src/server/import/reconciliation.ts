import { randomUUID } from "node:crypto";
import { scryfallIdSchema } from "@mtg/schemas";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { createOrMergeCollectionItem } from "../collection/items";
import { db } from "../db/client";
import {
  type CardRow,
  cards,
  type ImportReconciliationRowRow,
  importBatchItems,
  importReconciliationRows,
} from "../db/schema";
import { searchCards } from "../search/query";
import { buildColumnMap, extractRow, parseCondition, parseFinish } from "./archidekt-columns";

export interface ReconciliationRowView {
  id: string;
  reason: ImportReconciliationRowRow["reason"];
  rawRow: Record<string, string>;
  createdAt: Date;
  candidates: CardRow[];
}

/**
 * `ambiguous_printing` rows already have stored candidates from resolution
 * time; every other reason has none, so this falls back to a best-effort
 * FTS5 name search (KAD-10) over whatever the row's own Name-ish column
 * held, re-deriving the column map from the row's own header keys since
 * only per-row values, not the original batch's headers, are stored.
 */
function getCandidates(row: ImportReconciliationRowRow): CardRow[] {
  if (row.candidateScryfallIds && row.candidateScryfallIds.length > 0) {
    return db.select().from(cards).where(inArray(cards.id, row.candidateScryfallIds)).all();
  }
  const columnMap = buildColumnMap(Object.keys(row.rawRow));
  const parsed = extractRow(row.rawRow, columnMap);
  if (!parsed.name) return [];
  return searchCards(parsed.name, 5);
}

/** Open = not yet resolved and not dismissed. Across all batches - a solo collection has one active queue. */
export function listOpenReconciliationRows(): ReconciliationRowView[] {
  const rows = db
    .select()
    .from(importReconciliationRows)
    .where(
      and(
        isNull(importReconciliationRows.resolvedAt),
        isNull(importReconciliationRows.dismissedAt),
      ),
    )
    .all();

  return rows.map((row) => ({
    id: row.id,
    reason: row.reason,
    rawRow: row.rawRow,
    createdAt: row.createdAt,
    candidates: getCandidates(row),
  }));
}

export function countOpenReconciliationRows(): number {
  return db
    .select()
    .from(importReconciliationRows)
    .where(
      and(
        isNull(importReconciliationRows.resolvedAt),
        isNull(importReconciliationRows.dismissedAt),
      ),
    )
    .all().length;
}

export type ResolveReconciliationRowResult = { outcome: "resolved" } | { outcome: "not_found" };

/**
 * One-tap resolution: the caller only supplies which candidate printing is
 * correct, everything else (quantity/foil/condition) re-derives from the
 * row's original CSV values, same as a normal import row. Records an
 * import_batch_items contribution against the row's original batch so a
 * later "replace" re-import of that batch still reverses correctly.
 */
export function resolveReconciliationRow(
  rowId: string,
  scryfallId: string,
): ResolveReconciliationRowResult {
  const row = db
    .select()
    .from(importReconciliationRows)
    .where(eq(importReconciliationRows.id, rowId))
    .get();
  if (!row || row.resolvedAt || row.dismissedAt) return { outcome: "not_found" };

  const columnMap = buildColumnMap(Object.keys(row.rawRow));
  const parsed = extractRow(row.rawRow, columnMap);
  // The row's own quantity may be exactly what made it unresolved
  // (invalid_quantity) - default to 1 rather than blocking resolution.
  const quantity = parsed.quantity && parsed.quantity > 0 ? parsed.quantity : 1;

  const item = createOrMergeCollectionItem({
    scryfallId: scryfallIdSchema.parse(scryfallId),
    finish: parseFinish(parsed.foilRaw),
    condition: parseCondition(parsed.conditionRaw),
    quantity,
    isProxy: false,
    binderLocation: "",
    language: parsed.language ?? "en",
  });

  db.insert(importBatchItems)
    .values({
      id: randomUUID(),
      batchId: row.batchId,
      collectionItemId: item.id,
      quantityDelta: quantity,
    })
    .run();
  db.update(importReconciliationRows)
    .set({ resolvedAt: new Date() })
    .where(eq(importReconciliationRows.id, rowId))
    .run();

  return { outcome: "resolved" };
}

/** Bulk-dismiss (AC3) - only touches rows still open, returns how many were actually dismissed. */
export function dismissReconciliationRows(rowIds: string[]): number {
  if (rowIds.length === 0) return 0;
  const now = new Date();
  let dismissed = 0;
  for (const id of rowIds) {
    const result = db
      .update(importReconciliationRows)
      .set({ dismissedAt: now })
      .where(
        and(
          eq(importReconciliationRows.id, id),
          isNull(importReconciliationRows.resolvedAt),
          isNull(importReconciliationRows.dismissedAt),
        ),
      )
      .run();
    dismissed += result.changes;
  }
  return dismissed;
}
