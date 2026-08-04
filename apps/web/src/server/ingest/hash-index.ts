import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { hashToBytes, phash } from "@mtg/phash";
import { isCollectibleCard, scryfallCardSchema } from "@mtg/schemas";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { artworkHashes, cards, type NewArtworkHashRow } from "../db/schema";
import { markSyncResult, markSyncRunning } from "../sync/sync-state";
import { fetchBulkDataMeta } from "./bulk-data-meta";
import { decodeToRgba } from "./decode-image";
import { SCRYFALL_REQUEST_HEADERS } from "./user-agent";
import { iterateWebStream } from "./web-stream";

/**
 * How many images are in flight at once.
 *
 * Scryfall documents a rate limit on `api.scryfall.com`; the `*.scryfall.io`
 * image hosts it redirects to don't carry one. That is a reason to be
 * unhurried rather than a licence to open 200 sockets - this is ~47k requests
 * pointed at someone else's CDN for our convenience.
 */
const DEFAULT_CONCURRENCY = 8;

/** Retries per image before the artwork is counted as failed and skipped. */
const MAX_ATTEMPTS = 4;

/** Rows per insert transaction, so progress survives a kill. */
const BATCH_SIZE = 100;

export interface HashIndexOptions {
  readonly fetchImpl?: typeof fetch;
  readonly concurrency?: number;
  /**
   * Stop after this many artworks. Exists for the "verify on a small slice
   * before letting a multi-hour run go" step, which is not optional for a job
   * with 47k chances to be wrong.
   */
  readonly limit?: number;
  /** Reports progress; the status page reads `sync_state`, not this. */
  readonly onProgress?: (done: number, total: number) => void;
}

export interface HashIndexResult {
  readonly hashed: number;
  readonly skipped: number;
  readonly alreadyPresent: number;
  readonly sourceTimestamp: string;
}

/** One artwork to fetch: the URLs plus which printing they came from. */
interface ArtworkTask {
  readonly illustrationId: string;
  readonly sourceCardId: string;
  readonly artCropUrl: string;
  readonly fullUrl: string | null;
}

/**
 * Builds the perceptual-hash index over every distinct artwork (KAD-24).
 *
 * Sourced from the `unique_artwork` bulk file rather than `default_cards`:
 * ~47.4k artworks against ~96.5k paper printings, so half the downloads for
 * the same coverage. Images are streamed, hashed and discarded - the only
 * thing that touches disk is 8 bytes per artwork, so the ~5 GB that flows
 * through this job leaves nothing behind.
 */
export async function runHashIndexBuild(options: HashIndexOptions = {}): Promise<HashIndexResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  await markSyncRunning("hash_index");
  try {
    const { downloadUri, sourceUpdatedAt } = await fetchBulkDataMeta("unique_artwork", fetchImpl);
    const candidates = await collectArtworkTasks(downloadUri, fetchImpl);

    // Resumability, and incremental re-runs, are the same query: whatever is
    // already hashed is simply not work. Killing the job and restarting it
    // redoes nothing.
    const done = new Set(
      db
        .select({ id: artworkHashes.illustrationId })
        .from(artworkHashes)
        .all()
        .map((row) => row.id),
    );
    const pending = candidates.filter((task) => !done.has(task.illustrationId));
    const alreadyPresent = candidates.length - pending.length;
    const tasks = options.limit === undefined ? pending : pending.slice(0, options.limit);

    let hashed = 0;
    let skipped = 0;
    let batch: NewArtworkHashRow[] = [];

    const flush = () => {
      if (batch.length === 0) return;
      const rows = batch;
      batch = [];
      db.transaction((tx) => {
        // A concurrent run, or a retry after a partial batch, must not fail
        // the whole transaction on a key that is already there.
        tx.insert(artworkHashes).values(rows).onConflictDoNothing().run();
      });
    };

    await runWithConcurrency(tasks, concurrency, async (task) => {
      const row = await hashArtwork(task, fetchImpl);
      if (row === null) {
        skipped++;
      } else {
        batch.push(row);
        hashed++;
        if (batch.length >= BATCH_SIZE) flush();
      }
      options.onProgress?.(hashed + skipped, tasks.length);
    });
    flush();

    propagateHashesToCards();

    await markSyncResult("hash_index", {
      status: "success",
      // What the index actually holds, not what this run added - the status
      // page reads this as "rows", and after a resumed run "500 rows" would
      // badly misdescribe a 47k-row index.
      rowCount: countIndexedArtworks(),
      sourceTimestamp: sourceUpdatedAt,
    });
    return { hashed, skipped, alreadyPresent, sourceTimestamp: sourceUpdatedAt };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await markSyncResult("hash_index", { status: "error", errorMessage });
    throw error;
  }
}

/**
 * Streams the bulk file and reduces it to the artworks worth hashing.
 *
 * Filtered through `isCollectibleCard`, so tokens and emblems never enter the
 * index - an explicit AC, and the reason a scan can't come back "Forest
 * token". Cards without an `illustration_id` or without an `art_crop` are
 * dropped here rather than failing later: double-faced layouts carry both
 * per-face, and this story indexes the front-face artwork only.
 */
async function collectArtworkTasks(
  downloadUri: string,
  fetchImpl: typeof fetch,
): Promise<ArtworkTask[]> {
  const response = await fetchImpl(downloadUri, { headers: SCRYFALL_REQUEST_HEADERS });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download unique_artwork bulk data: HTTP ${String(response.status)}`);
  }

  const gunzip = createGunzip();
  Readable.from(iterateWebStream(response.body)).pipe(gunzip);
  const lines = createInterface({ input: gunzip, crlfDelay: Number.POSITIVE_INFINITY });

  const tasks = new Map<string, ArtworkTask>();
  for await (const line of lines) {
    if (line.trim() === "") continue;

    const parsed = scryfallCardSchema.safeParse(JSON.parse(line));
    if (!parsed.success || !isCollectibleCard(parsed.data)) continue;

    const card = parsed.data;
    const illustrationId = card.illustration_id;
    const artCropUrl = card.image_uris?.["art_crop"];
    if (illustrationId === undefined || artCropUrl === undefined) continue;
    // `unique_artwork` is already one row per artwork, but a Map keyed on the
    // illustration id costs nothing and makes that an assertion rather than
    // an assumption.
    if (tasks.has(illustrationId)) continue;

    tasks.set(illustrationId, {
      illustrationId,
      sourceCardId: card.id,
      artCropUrl,
      // `small` rather than `normal`: a 64-bit pHash downsamples to 32x32
      // regardless, so 146x204 is ample, and it is ~10 KB against ~200 KB.
      // Over 47.4k artworks that is the difference between adding ~0.5 GB of
      // transfer to this job and adding ~9.5 GB, for an identical hash.
      fullUrl: card.image_uris?.["small"] ?? null,
    });
  }
  return [...tasks.values()];
}

/**
 * Fetches and hashes one artwork. Returns null when the art crop could not be
 * had - a single unreachable image must not abort a multi-hour run.
 */
async function hashArtwork(
  task: ArtworkTask,
  fetchImpl: typeof fetch,
): Promise<NewArtworkHashRow | null> {
  const artBytes = await fetchImageBytes(task.artCropUrl, fetchImpl);
  if (artBytes === null) return null;

  let artPhash: bigint;
  try {
    artPhash = phash(await decodeToRgba(artBytes));
  } catch {
    // A corrupt or unexpected payload is one bad artwork, not a bad run.
    return null;
  }

  // The full-card hash is best-effort: the art hash is what the recognizer
  // needs, so losing the second one must not discard the first. This is why
  // `full_phash` is the one nullable column on the table.
  let fullPhash: Buffer | null = null;
  if (task.fullUrl !== null) {
    const fullBytes = await fetchImageBytes(task.fullUrl, fetchImpl);
    if (fullBytes !== null) {
      try {
        fullPhash = Buffer.from(hashToBytes(phash(await decodeToRgba(fullBytes))));
      } catch {
        fullPhash = null;
      }
    }
  }

  return {
    illustrationId: task.illustrationId,
    artPhash: Buffer.from(hashToBytes(artPhash)),
    fullPhash,
    sourceCardId: task.sourceCardId,
    createdAt: new Date(),
  };
}

/**
 * One image, with exponential backoff on the responses that mean "later"
 * rather than "no". A 404 is permanent and retrying it just wastes someone
 * else's bandwidth, so only 429 and 5xx are retried.
 */
async function fetchImageBytes(url: string, fetchImpl: typeof fetch): Promise<Uint8Array | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(url, { headers: SCRYFALL_REQUEST_HEADERS });
      if (response.ok) return new Uint8Array(await response.arrayBuffer());
      if (response.status !== 429 && response.status < 500) return null;
    } catch {
      // Network-level failure: retried on the same schedule as a 503.
    }
    if (attempt < MAX_ATTEMPTS) await delay(2 ** attempt * 250);
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `worker` over `items` with at most `concurrency` in flight.
 *
 * Workers pull from a shared cursor rather than the list being sliced into
 * per-worker chunks: image sizes and CDN latencies vary enough that fixed
 * chunks would leave workers idle at the tail of a 47k-item run.
 */
async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Copies hashes onto every printing sharing an artwork.
 *
 * This is where keying the index on artwork pays off twice: one hash computed
 * once lands on all ~96.5k printings, including printings that were not in
 * the `unique_artwork` file at all because a different printing represented
 * that artwork. Run at the end of a build rather than per-row - it is a
 * single join, and doing it 47k times would be 47k full-table updates.
 */
function propagateHashesToCards(): void {
  db.run(sql`
    UPDATE cards SET
      art_phash = (
        SELECT art_phash FROM artwork_hashes
        WHERE artwork_hashes.illustration_id = cards.illustration_id
      ),
      full_phash = (
        SELECT full_phash FROM artwork_hashes
        WHERE artwork_hashes.illustration_id = cards.illustration_id
      )
    WHERE cards.illustration_id IN (SELECT illustration_id FROM artwork_hashes)
  `);
}

function countIndexedArtworks(): number {
  const row = db.select({ count: sql<number>`count(*)` }).from(artworkHashes).get();
  return row?.count ?? 0;
}
