import { db } from "../db/client";
import { SYNC_TYPES, type SyncStateRow, type SyncType, syncState } from "../db/schema";

export interface SyncStatusView {
  syncType: SyncType;
  label: string;
  status: SyncStateRow["status"];
  rowCount: number | null;
  sourceTimestamp: string | null;
  lastSyncedAt: Date | null;
  errorMessage: string | null;
  triggerable: boolean;
}

const SYNC_TYPE_LABELS: Record<SyncType, string> = {
  cards: "Cards",
  prices: "Prices",
  hash_index: "Hash index",
};

// Only the card sync job exists yet (KAD-8). Prices (KAD-11) and the hash
// index build (KAD-24) land in later sprints - shown here so the status
// page's shape doesn't change out from under KAD-9 when they do.
const TRIGGERABLE: Record<SyncType, boolean> = {
  cards: true,
  prices: false,
  hash_index: false,
};

/**
 * Every sync type is always represented, even before its first run - AC4
 * requires an actionable setup prompt, never an empty state, for a sync
 * that has never succeeded.
 */
export function getSyncStatuses(): SyncStatusView[] {
  const rows = db.select().from(syncState).all();
  const bySyncType = new Map(rows.map((row) => [row.syncType, row]));

  return SYNC_TYPES.map((syncType) => {
    const row = bySyncType.get(syncType);
    return {
      syncType,
      label: SYNC_TYPE_LABELS[syncType],
      status: row?.status ?? "never_run",
      rowCount: row?.rowCount ?? null,
      sourceTimestamp: row?.sourceTimestamp ?? null,
      lastSyncedAt: row?.lastSyncedAt ?? null,
      errorMessage: row?.errorMessage ?? null,
      triggerable: TRIGGERABLE[syncType],
    };
  });
}
