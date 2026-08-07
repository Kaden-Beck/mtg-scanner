import { CardNotFoundError, createOrMergeCollectionItem } from "../collection/items.ts";
import { serializeCollectionItemForScan } from "./undo.ts";

export { CardNotFoundError };

/**
 * Commit a resolved scan into the collection and report how much quantity
 * this capture added (KAD-48 / KAD-49).
 */
export function commitScan(request: Parameters<typeof createOrMergeCollectionItem>[0]) {
  const item = createOrMergeCollectionItem(request);
  return {
    item: serializeCollectionItemForScan(item),
    quantityAdded: request.quantity,
  };
}
