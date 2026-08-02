import { createHash, randomUUID } from "node:crypto";
import type { ImportArchidektRequest } from "@mtg/schemas";
import { scryfallIdSchema } from "@mtg/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { createOrMergeCollectionItem } from "../collection/items";
import { db } from "../db/client";
import {
  collectionItems,
  type ImportBatchRow,
  importBatches,
  importBatchItems,
  importReconciliationRows,
  type NewImportBatchRow,
  type UnresolvedReason,
} from "../db/schema";
import { buildColumnMap, extractRow, parseCondition, parseFinish } from "./archidekt-columns";
import { parseCsvRecords } from "./csv-parse";
import { resolvePrinting } from "./printing-resolver";

export type ImportArchidektOptions = ImportArchidektRequest;

export type ImportArchidektOutcome =
  | { outcome: "duplicate_detected"; priorBatch: ImportBatchRow }
  | { outcome: "completed"; batch: ImportBatchRow };

/**
 * Reverses exactly what a prior batch contributed to collection_items -
 * used by a "replace" re-import so it never double-counts a duplicate file
 * (AC3). Rows the batch created are removed entirely once their quantity
 * would drop to zero or below; rows also touched by other activity since
 * are decremented, not deleted.
 */
function reverseBatch(batchId: string): void {
  const contributions = db
    .select()
    .from(importBatchItems)
    .where(eq(importBatchItems.batchId, batchId))
    .all();

  for (const contribution of contributions) {
    const current = db
      .select()
      .from(collectionItems)
      .where(eq(collectionItems.id, contribution.collectionItemId))
      .get();
    if (!current) continue; // already gone independently of this batch

    const remaining = current.quantity - contribution.quantityDelta;
    if (remaining <= 0) {
      // import_batch_items rows (including this batch's own, and any
      // other batch that also ever contributed to this now-zeroed stack)
      // reference collection_items via FK - clear them first, or deleting
      // the collection_item violates the constraint.
      db.delete(importBatchItems).where(eq(importBatchItems.collectionItemId, current.id)).run();
      db.delete(collectionItems).where(eq(collectionItems.id, current.id)).run();
    } else {
      db.update(collectionItems)
        .set({ quantity: remaining, updatedAt: new Date() })
        .where(eq(collectionItems.id, current.id))
        .run();
    }
  }
}

/**
 * Parses an Archidekt (or Archidekt-compatible) collection CSV, resolves
 * each row to a printing, and writes into collection_items - preserving
 * quantity, foil, and condition (AC1). Rows that can't be resolved
 * unambiguously land in the reconciliation queue rather than being dropped
 * (AC2). A duplicate upload of the same file requires an explicit
 * merge/replace choice before anything is written (AC3).
 */
export function importArchidektCsv(options: ImportArchidektOptions): ImportArchidektOutcome {
  const fileHash = createHash("sha256").update(options.csvText).digest("hex");

  const priorBatch = db
    .select()
    .from(importBatches)
    .where(
      and(
        eq(importBatches.fileHash, fileHash),
        eq(importBatches.status, "completed"),
        isNull(importBatches.supersededByBatchId),
      ),
    )
    .get();

  if (priorBatch && !options.duplicateAction) {
    return { outcome: "duplicate_detected", priorBatch };
  }

  const batchId = randomUUID();
  const now = new Date();

  if (priorBatch && options.duplicateAction === "replace") {
    reverseBatch(priorBatch.id);
    db.update(importBatches)
      .set({ supersededByBatchId: batchId })
      .where(eq(importBatches.id, priorBatch.id))
      .run();
  }

  const { headers, rows } = parseCsvRecords(options.csvText);
  const columnMap = buildColumnMap(headers);

  // Inserted up front (with placeholder counts) rather than after the loop -
  // importBatchItems/importReconciliationRows rows written during the loop
  // reference batchId via a foreign key and need the parent row to already
  // exist.
  const initialBatch: NewImportBatchRow = {
    id: batchId,
    source: "archidekt",
    fileName: options.fileName,
    fileHash,
    status: "completed",
    totalRows: rows.length,
    resolvedRows: 0,
    unresolvedRows: 0,
    supersededByBatchId: null,
    errorMessage: null,
    createdAt: now,
  };
  db.insert(importBatches).values(initialBatch).run();

  let resolvedRows = 0;
  let unresolvedRows = 0;

  for (const rawRow of rows) {
    const parsed = extractRow(rawRow, columnMap);

    if (parsed.quantity === null || parsed.quantity <= 0) {
      insertReconciliationRow(batchId, rawRow, "invalid_quantity", undefined, now);
      unresolvedRows++;
      continue;
    }

    const resolution = resolvePrinting(parsed);
    if (resolution.outcome === "unresolved") {
      insertReconciliationRow(
        batchId,
        rawRow,
        resolution.reason,
        resolution.reason === "ambiguous_printing" ? resolution.candidateIds : undefined,
        now,
      );
      unresolvedRows++;
      continue;
    }

    const item = createOrMergeCollectionItem({
      scryfallId: scryfallIdSchema.parse(resolution.card.id),
      finish: parseFinish(parsed.foilRaw),
      condition: parseCondition(parsed.conditionRaw),
      quantity: parsed.quantity,
      isProxy: false,
      binderLocation: "",
      language: parsed.language ?? "en",
    });
    db.insert(importBatchItems)
      .values({
        id: randomUUID(),
        batchId,
        collectionItemId: item.id,
        quantityDelta: parsed.quantity,
      })
      .run();
    resolvedRows++;
  }

  db.update(importBatches)
    .set({ resolvedRows, unresolvedRows })
    .where(eq(importBatches.id, batchId))
    .run();
  const batch = db.select().from(importBatches).where(eq(importBatches.id, batchId)).get();
  if (!batch) throw new Error("import batch vanished immediately after insert");

  return { outcome: "completed", batch };
}

function insertReconciliationRow(
  batchId: string,
  rawRow: Record<string, string>,
  reason: UnresolvedReason,
  candidateScryfallIds: string[] | undefined,
  now: Date,
): void {
  db.insert(importReconciliationRows)
    .values({
      id: randomUUID(),
      batchId,
      rawRow,
      reason,
      candidateScryfallIds: candidateScryfallIds ?? null,
      createdAt: now,
    })
    .run();
}
