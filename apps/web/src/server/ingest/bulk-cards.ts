import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { isCollectibleCard, scryfallCardSchema } from "@mtg/schemas";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { cards, type NewCardRow } from "../db/schema";
import { rebuildCardsFts } from "../search/fts";
import { markSyncResult, markSyncRunning } from "../sync/sync-state";
import { fetchBulkDataMeta } from "./bulk-data-meta";
import { toCardRow } from "./card-row-mapper";
import { SCRYFALL_REQUEST_HEADERS } from "./user-agent";
import { iterateWebStream } from "./web-stream";

// SQLite caps bound parameters per statement (SQLITE_MAX_VARIABLE_NUMBER).
// `cards` has ~36 columns, so 1000 rows/batch means ~36k params - well past
// the limit. Found by running this against the real bulk file, not the
// batch size that made the mocked (2-row) tests pass. Sized with headroom.
const BATCH_SIZE = 200;

// Column -> `excluded.<col>` for every column except the conflict target
// (`id`) and `created_at`, which should keep its original value across a
// re-sync. A per-row-literal `set` would apply the SAME values to every
// conflicting row in the batch; referencing `excluded` gives each row its
// own values, which is what an idempotent bulk upsert actually needs.
const upsertSet = {
  oracleId: sql.raw("excluded.oracle_id"),
  name: sql.raw("excluded.name"),
  layout: sql.raw("excluded.layout"),
  manaCost: sql.raw("excluded.mana_cost"),
  cmc: sql.raw("excluded.cmc"),
  typeLine: sql.raw("excluded.type_line"),
  oracleText: sql.raw("excluded.oracle_text"),
  colors: sql.raw("excluded.colors"),
  colorIdentity: sql.raw("excluded.color_identity"),
  keywords: sql.raw("excluded.keywords"),
  legalities: sql.raw("excluded.legalities"),
  games: sql.raw("excluded.games"),
  reserved: sql.raw("excluded.reserved"),
  setCode: sql.raw("excluded.set_code"),
  setName: sql.raw("excluded.set_name"),
  setType: sql.raw("excluded.set_type"),
  collectorNumber: sql.raw("excluded.collector_number"),
  rarity: sql.raw("excluded.rarity"),
  releasedAt: sql.raw("excluded.released_at"),
  artist: sql.raw("excluded.artist"),
  borderColor: sql.raw("excluded.border_color"),
  frame: sql.raw("excluded.frame"),
  fullArt: sql.raw("excluded.full_art"),
  textless: sql.raw("excluded.textless"),
  promo: sql.raw("excluded.promo"),
  variation: sql.raw("excluded.variation"),
  finishes: sql.raw("excluded.finishes"),
  cardFaces: sql.raw("excluded.card_faces"),
  imageUris: sql.raw("excluded.image_uris"),
  scryfallUri: sql.raw("excluded.scryfall_uri"),
  prices: sql.raw("excluded.prices"),
  updatedAt: sql.raw("excluded.updated_at"),
};

function upsertBatch(batch: NewCardRow[]): void {
  db.transaction((tx) => {
    tx.insert(cards).values(batch).onConflictDoUpdate({ target: cards.id, set: upsertSet }).run();
  });
}

export interface CardSyncResult {
  rowCount: number;
  sourceTimestamp: string;
}

/**
 * Streams Scryfall's `default_cards` bulk file (gzip-compressed JSONL - see
 * packages/schemas/src/scryfall-card.ts for how that was confirmed rather
 * than assumed), validates and filters each row, and upserts in batches of
 * {@link BATCH_SIZE} so no single transaction holds the write lock for the
 * whole run (KAD-8 AC3).
 */
export async function runCardSync(fetchImpl: typeof fetch = fetch): Promise<CardSyncResult> {
  await markSyncRunning("cards");
  try {
    const { downloadUri, sourceUpdatedAt } = await fetchBulkDataMeta("default_cards", fetchImpl);

    const response = await fetchImpl(downloadUri, { headers: SCRYFALL_REQUEST_HEADERS });
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download bulk data: HTTP ${String(response.status)}`);
    }

    const gunzip = createGunzip();
    Readable.from(iterateWebStream(response.body)).pipe(gunzip);
    const lines = createInterface({ input: gunzip, crlfDelay: Number.POSITIVE_INFINITY });

    let batch: NewCardRow[] = [];
    let rowCount = 0;
    const now = new Date();

    for await (const line of lines) {
      if (line.trim() === "") continue; // trailing newline at EOF

      const parsed = scryfallCardSchema.safeParse(JSON.parse(line));
      if (!parsed.success || !isCollectibleCard(parsed.data)) continue;

      batch.push(toCardRow(parsed.data, now));
      if (batch.length >= BATCH_SIZE) {
        upsertBatch(batch);
        rowCount += batch.length;
        batch = [];
      }
    }
    if (batch.length > 0) {
      upsertBatch(batch);
      rowCount += batch.length;
    }

    // Full rebuild (KAD-10), not incremental - see server/search/fts.ts. A
    // rebuild failure fails the whole sync rather than leaving a stale
    // search index passing silently.
    rebuildCardsFts();

    await markSyncResult("cards", {
      status: "success",
      rowCount,
      sourceTimestamp: sourceUpdatedAt,
    });
    return { rowCount, sourceTimestamp: sourceUpdatedAt };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await markSyncResult("cards", { status: "error", errorMessage });
    throw error;
  }
}
