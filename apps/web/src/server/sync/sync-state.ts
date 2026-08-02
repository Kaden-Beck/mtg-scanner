import { db } from "../db/client";
import { type SyncType, syncState } from "../db/schema";

/**
 * Shared `sync_state` bookkeeping - every sync job (card ingest, price
 * refresh, and future jobs) marks itself running before work starts and
 * records a result in a try/catch-driven finally-equivalent, so a job that
 * throws still leaves an accurate status instead of stuck on "running".
 */
export async function markSyncRunning(syncType: SyncType): Promise<void> {
  await db
    .insert(syncState)
    .values({ syncType, status: "running", updatedAt: new Date() })
    .onConflictDoUpdate({
      target: syncState.syncType,
      set: { status: "running", updatedAt: new Date() },
    });
}

export type SyncResult =
  | { status: "success"; rowCount: number; sourceTimestamp: string }
  | { status: "error"; errorMessage: string };

export async function markSyncResult(syncType: SyncType, result: SyncResult): Promise<void> {
  const now = new Date();
  await db
    .insert(syncState)
    .values({
      syncType,
      status: result.status,
      updatedAt: now,
      ...(result.status === "success"
        ? { rowCount: result.rowCount, sourceTimestamp: result.sourceTimestamp, lastSyncedAt: now }
        : { errorMessage: result.errorMessage }),
    })
    .onConflictDoUpdate({
      target: syncState.syncType,
      set:
        result.status === "success"
          ? {
              status: "success",
              rowCount: result.rowCount,
              sourceTimestamp: result.sourceTimestamp,
              lastSyncedAt: now,
              errorMessage: null,
              updatedAt: now,
            }
          : { status: "error", errorMessage: result.errorMessage, updatedAt: now },
    });
}
