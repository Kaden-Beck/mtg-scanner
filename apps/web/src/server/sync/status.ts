import { connection } from "next/server";
import { db } from "../db/client";
import { SYNC_TYPES, type SyncStateRow, type SyncType, syncState } from "../db/schema";
import { isStale } from "./staleness";

export interface SyncStatusView {
  syncType: SyncType;
  label: string;
  status: SyncStateRow["status"];
  rowCount: number | null;
  sourceTimestamp: string | null;
  lastSyncedAt: Date | null;
  errorMessage: string | null;
  triggerable: boolean;
  stale: boolean;
}

const SYNC_TYPE_LABELS: Record<SyncType, string> = {
  cards: "Cards",
  prices: "Prices",
  hash_index: "Hash index",
};

const TRIGGERABLE: Record<SyncType, boolean> = {
  cards: true,
  prices: true,
  // Triggerable as of KAD-24. Unlike the other two this is a multi-hour run
  // over ~47.4k images; the page warns about that next to the button rather
  // than presenting it as another half-minute sync.
  hash_index: true,
};

/**
 * Every sync type is always represented, even before its first run - AC4
 * requires an actionable setup prompt, never an empty state, for a sync
 * that has never succeeded.
 *
 * `connection()` opts this out of static prerendering: better-sqlite3 is
 * synchronous, so without it Next would happily read sync_state once at
 * build time and bake that snapshot into a static page forever (confirmed
 * by actually building the image - `next build` reported `/` as prerendered
 * static content until this was added).
 */
export async function getSyncStatuses(): Promise<SyncStatusView[]> {
  await connection();
  const rows = db.select().from(syncState).all();
  const bySyncType = new Map(rows.map((row) => [row.syncType, row]));

  const now = new Date();
  return SYNC_TYPES.map((syncType) => {
    const row = bySyncType.get(syncType);
    const lastSyncedAt = row?.lastSyncedAt ?? null;
    return {
      syncType,
      label: SYNC_TYPE_LABELS[syncType],
      status: row?.status ?? "never_run",
      rowCount: row?.rowCount ?? null,
      sourceTimestamp: row?.sourceTimestamp ?? null,
      lastSyncedAt,
      errorMessage: row?.errorMessage ?? null,
      triggerable: TRIGGERABLE[syncType],
      stale: isStale(lastSyncedAt, now),
    };
  });
}
