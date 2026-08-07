import {
  collectionItemIdSchema,
  collectionItemResponseSchema,
  type ScanUndoResponse,
} from "@mtg/schemas";
import {
  deleteCollectionItem,
  getCollectionItem,
  updateCollectionItem,
} from "../collection/items.ts";
import type { CollectionItemRow } from "../db/schema.ts";

export function serializeCollectionItemForScan(row: CollectionItemRow) {
  return collectionItemResponseSchema.parse({
    id: row.id,
    scryfallId: row.scryfallId,
    finish: row.finish,
    condition: row.condition,
    quantity: row.quantity,
    isProxy: row.isProxy,
    binderLocation: row.binderLocation,
    language: row.language,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * Reverse one scan commit's quantity contribution (KAD-49).
 *
 * Decrements by `quantityDelta`; deletes the stack when quantity would hit 0.
 * Idempotent on a missing row (`not_found`) so a double-tap undo is safe.
 */
export function undoScanCommit(collectionItemId: string, quantityDelta: number): ScanUndoResponse {
  const existing = getCollectionItem(collectionItemId);
  if (!existing) {
    return { outcome: "not_found" };
  }

  if (existing.quantity <= quantityDelta) {
    deleteCollectionItem(collectionItemId);
    return {
      outcome: "deleted",
      collectionItemId: collectionItemIdSchema.parse(existing.id),
    };
  }

  const nextQuantity = existing.quantity - quantityDelta;
  const result = updateCollectionItem(collectionItemId, { quantity: nextQuantity });
  if (result.outcome !== "updated") {
    return { outcome: "not_found" };
  }

  return {
    outcome: "decremented",
    item: serializeCollectionItemForScan(result.row),
  };
}
