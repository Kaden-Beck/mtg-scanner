import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { isCollectibleCard, scryfallCardSchema } from "@mtg/schemas";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { cards } from "../db/schema";
import { markSyncResult, markSyncRunning } from "../sync/sync-state";
import { fetchBulkDataMeta } from "./bulk-data-meta";
import { SCRYFALL_REQUEST_HEADERS } from "./user-agent";
import { iterateWebStream } from "./web-stream";

// Each UPDATE here has 3 bound params, nowhere near
// SQLITE_MAX_VARIABLE_NUMBER regardless of chunk size - unlike bulk-cards.ts's
// BATCH_SIZE, this only bounds how long one transaction holds the write lock.
const TRANSACTION_CHUNK_SIZE = 1000;

interface PriceUpdate {
  id: string;
  prices: Record<string, string | null>;
}

function applyChunk(chunk: PriceUpdate[], now: Date): void {
  db.transaction((tx) => {
    for (const row of chunk) {
      tx.update(cards)
        .set({ prices: row.prices, updatedAt: now })
        .where(eq(cards.id, row.id))
        .run();
    }
  });
}

export interface PriceRefreshResult {
  rowCount: number;
  sourceTimestamp: string;
}

/**
 * Re-streams Scryfall's `default_cards` bulk file (the same source as the
 * card sync - Scryfall doesn't publish a prices-only bulk file) but touches
 * only `prices`/`updated_at` on rows that already exist. Never inserts a new
 * card row - a printing must already be known from the card sync (KAD-8) -
 * and never touches gameplay columns (AC1). Decoupled cadence from the card
 * sync deliberately (KAD-11): prices go stale within 24h, gameplay data
 * changes rarely enough that a slower cadence is fine.
 */
export async function runPriceRefresh(
  fetchImpl: typeof fetch = fetch,
): Promise<PriceRefreshResult> {
  await markSyncRunning("prices");
  try {
    const { downloadUri, sourceUpdatedAt } = await fetchBulkDataMeta("default_cards", fetchImpl);

    const response = await fetchImpl(downloadUri, { headers: SCRYFALL_REQUEST_HEADERS });
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download bulk data: HTTP ${String(response.status)}`);
    }

    const gunzip = createGunzip();
    Readable.from(iterateWebStream(response.body)).pipe(gunzip);
    const lines = createInterface({ input: gunzip, crlfDelay: Number.POSITIVE_INFINITY });

    let chunk: PriceUpdate[] = [];
    let rowCount = 0;
    const now = new Date();

    for await (const line of lines) {
      if (line.trim() === "") continue; // trailing newline at EOF

      const parsed = scryfallCardSchema.safeParse(JSON.parse(line));
      if (!parsed.success || !isCollectibleCard(parsed.data)) continue;

      chunk.push({ id: parsed.data.id, prices: parsed.data.prices });
      if (chunk.length >= TRANSACTION_CHUNK_SIZE) {
        applyChunk(chunk, now);
        rowCount += chunk.length;
        chunk = [];
      }
    }
    if (chunk.length > 0) {
      applyChunk(chunk, now);
      rowCount += chunk.length;
    }

    await markSyncResult("prices", {
      status: "success",
      rowCount,
      sourceTimestamp: sourceUpdatedAt,
    });
    return { rowCount, sourceTimestamp: sourceUpdatedAt };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await markSyncResult("prices", { status: "error", errorMessage });
    throw error;
  }
}
