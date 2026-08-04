import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-hash-index-test-"));
  process.env["DATABASE_PATH"] = join(dir, "test.db");
  process.env["DRIZZLE_MIGRATIONS_FOLDER"] = join(import.meta.dirname, "../../../drizzle");
});

afterEach(() => {
  globalThis.__mtgSqlite?.close();
  globalThis.__mtgSqlite = undefined;
  globalThis.__mtgDb = undefined;
  rmSync(dir, { recursive: true, force: true });
  delete process.env["DATABASE_PATH"];
  delete process.env["DRIZZLE_MIGRATIONS_FOLDER"];
});

const ART_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ART_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const CARD_A = "0000419b-0bba-4488-8f7a-6194544ce91e";
const CARD_B = "1c2e5c1a-9d3f-4d21-88d1-2b91b6f2a0aa";
/** A second printing of ART_A - the reprint case the artwork key exists for. */
const CARD_A_REPRINT = "3f8b1d92-4c7a-4a55-9a2e-77c0d3e1b845";

function artworkCard(overrides: Record<string, unknown>) {
  return {
    object: "card" as const,
    id: CARD_A,
    oracle_id: "b34bb2dc-c1af-4d77-b0b3-a0fb342a5fc6",
    name: "Forest",
    lang: "en",
    released_at: "2024-08-02",
    layout: "normal",
    mana_cost: "",
    cmc: 0,
    type_line: "Basic Land — Forest",
    colors: [],
    color_identity: ["G"],
    keywords: [],
    legalities: { standard: "legal" },
    games: ["paper"],
    reserved: false,
    finishes: ["nonfoil"],
    set: "blb",
    set_name: "Bloomburrow",
    set_type: "expansion",
    collector_number: "280",
    rarity: "common",
    border_color: "black",
    frame: "2015",
    full_art: true,
    textless: false,
    promo: false,
    variation: false,
    illustration_id: ART_A,
    image_uris: {
      art_crop: "https://cards.scryfall.io/art_crop/a.jpg",
      small: "https://cards.scryfall.io/small/a.jpg",
    },
    scryfall_uri: "https://scryfall.com/card/blb/280/forest",
    prices: { usd: "0.31" },
    ...overrides,
  };
}

function gzippedJsonl(objects: unknown[]): Uint8Array {
  return new Uint8Array(
    gzipSync(Buffer.from(`${objects.map((o) => JSON.stringify(o)).join("\n")}\n`)),
  );
}

function toStreamBody(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/**
 * A real encoded JPEG, not a stub: the decode step is `sharp`, and handing it
 * bytes that are not an image would test the error path instead of the happy
 * one. Distinct per seed so two artworks get genuinely different hashes.
 */
async function jpegBytes(seed: number): Promise<Uint8Array> {
  const size = 64;
  const pixels = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      pixels[i] = (x * seed) % 256;
      pixels[i + 1] = (y * 3 + seed * 40) % 256;
      pixels[i + 2] = (x * y) % 256;
    }
  }
  const encoded = await sharp(pixels, { raw: { width: size, height: size, channels: 3 } })
    .jpeg()
    .toBuffer();
  return new Uint8Array(encoded);
}

interface FetchOptions {
  readonly bulkBody: Uint8Array;
  readonly images: Map<string, Uint8Array>;
  /** URL -> statuses to answer with before succeeding. */
  readonly failures?: Map<string, number[]>;
  readonly onImageRequest?: (url: string) => void;
}

function makeFetch(options: FetchOptions): typeof fetch {
  const remaining = new Map(
    [...(options.failures ?? new Map<string, number[]>())].map(([url, codes]) => [url, [...codes]]),
  );

  return (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url === "https://api.scryfall.com/bulk-data") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              {
                type: "unique_artwork",
                updated_at: "2026-08-03T10:00:00Z",
                jsonl_download_uri: "https://data.scryfall.io/unique-artwork/x.jsonl.gz",
              },
            ],
          }),
          { status: 200 },
        ),
      );
    }

    if (url === "https://data.scryfall.io/unique-artwork/x.jsonl.gz") {
      return Promise.resolve(new Response(toStreamBody(options.bulkBody), { status: 200 }));
    }

    options.onImageRequest?.(url);

    const pending = remaining.get(url);
    if (pending !== undefined && pending.length > 0) {
      const status = pending.shift() ?? 500;
      return Promise.resolve(new Response("", { status }));
    }

    const bytes = options.images.get(url);
    if (bytes === undefined) return Promise.resolve(new Response("", { status: 404 }));
    return Promise.resolve(new Response(toStreamBody(bytes), { status: 200 }));
  };
}

async function defaultImages(): Promise<Map<string, Uint8Array>> {
  return new Map([
    ["https://cards.scryfall.io/art_crop/a.jpg", await jpegBytes(1)],
    ["https://cards.scryfall.io/small/a.jpg", await jpegBytes(2)],
    ["https://cards.scryfall.io/art_crop/b.jpg", await jpegBytes(3)],
    ["https://cards.scryfall.io/small/b.jpg", await jpegBytes(4)],
  ]);
}

const cardB = {
  id: CARD_B,
  name: "Island",
  illustration_id: ART_B,
  image_uris: {
    art_crop: "https://cards.scryfall.io/art_crop/b.jpg",
    small: "https://cards.scryfall.io/small/b.jpg",
  },
};

describe("runHashIndexBuild", () => {
  it("hashes each artwork and records sync_state", async () => {
    const { runHashIndexBuild } = await import("./hash-index");
    const { db } = await import("../db/client");
    const { artworkHashes, syncState } = await import("../db/schema");

    const result = await runHashIndexBuild({
      fetchImpl: makeFetch({
        bulkBody: gzippedJsonl([artworkCard({}), artworkCard(cardB)]),
        images: await defaultImages(),
      }),
      concurrency: 2,
    });

    expect(result.hashed).toBe(2);
    expect(result.skipped).toBe(0);

    const rows = db.select().from(artworkHashes).all();
    expect(rows).toHaveLength(2);
    // 8-byte big-endian blobs, per packages/phash's encoding.
    expect(rows[0]?.artPhash).toHaveLength(8);
    expect(rows[0]?.fullPhash).toHaveLength(8);
    // Different artwork must not collapse to the same hash, or the index is
    // worthless however fast it scans.
    expect(rows[0]?.artPhash.equals(rows[1]?.artPhash ?? Buffer.alloc(0))).toBe(false);

    const state = db.select().from(syncState).all();
    expect(state[0]?.syncType).toBe("hash_index");
    expect(state[0]?.status).toBe("success");
    expect(state[0]?.rowCount).toBe(2);
    expect(state[0]?.sourceTimestamp).toBe("2026-08-03T10:00:00Z");
  });

  it("records which printing's images were hashed", async () => {
    const { runHashIndexBuild } = await import("./hash-index");
    const { db } = await import("../db/client");
    const { artworkHashes } = await import("../db/schema");

    await runHashIndexBuild({
      fetchImpl: makeFetch({
        bulkBody: gzippedJsonl([artworkCard({})]),
        images: await defaultImages(),
      }),
    });

    const row = db.select().from(artworkHashes).all()[0];
    expect(row?.illustrationId).toBe(ART_A);
    expect(row?.sourceCardId).toBe(CARD_A);
  });

  /** An explicit AC: a scan must never come back "Bear Token". */
  it("keeps tokens and emblems out of the index", async () => {
    const { runHashIndexBuild } = await import("./hash-index");
    const { db } = await import("../db/client");
    const { artworkHashes } = await import("../db/schema");

    const result = await runHashIndexBuild({
      fetchImpl: makeFetch({
        bulkBody: gzippedJsonl([
          artworkCard({}),
          artworkCard({ ...cardB, layout: "token", set_type: "token" }),
        ]),
        images: await defaultImages(),
      }),
    });

    expect(result.hashed).toBe(1);
    expect(db.select().from(artworkHashes).all()).toHaveLength(1);
  });

  it("skips cards with no illustration_id or no art crop", async () => {
    const { runHashIndexBuild } = await import("./hash-index");

    const result = await runHashIndexBuild({
      fetchImpl: makeFetch({
        bulkBody: gzippedJsonl([
          artworkCard({ illustration_id: undefined }),
          artworkCard({ ...cardB, image_uris: { small: "https://cards.scryfall.io/small/b.jpg" } }),
        ]),
        images: await defaultImages(),
      }),
    });

    // Neither is a failure - they are simply not artworks this job indexes.
    expect(result.hashed).toBe(0);
    expect(result.skipped).toBe(0);
  });

  /**
   * The resumability AC. The second run must do no image work at all, which
   * is asserted by counting requests rather than by trusting the return
   * value - a job that re-fetched and re-wrote identical rows would report
   * the same numbers.
   */
  it("redoes nothing on a second run", async () => {
    const { runHashIndexBuild } = await import("./hash-index");
    const { db } = await import("../db/client");
    const { artworkHashes } = await import("../db/schema");

    const bulkBody = gzippedJsonl([artworkCard({}), artworkCard(cardB)]);
    const images = await defaultImages();
    await runHashIndexBuild({ fetchImpl: makeFetch({ bulkBody, images }) });

    const imageRequests: string[] = [];
    const second = await runHashIndexBuild({
      fetchImpl: makeFetch({
        bulkBody,
        images,
        onImageRequest: (url) => imageRequests.push(url),
      }),
    });

    expect(second.hashed).toBe(0);
    expect(second.alreadyPresent).toBe(2);
    expect(imageRequests).toEqual([]);
    expect(db.select().from(artworkHashes).all()).toHaveLength(2);
  });

  /** Killing the job mid-run has to leave the finished work behind. */
  it("resumes from a partial run without redoing it", async () => {
    const { runHashIndexBuild } = await import("./hash-index");
    const { db } = await import("../db/client");
    const { artworkHashes } = await import("../db/schema");

    const bulkBody = gzippedJsonl([artworkCard({}), artworkCard(cardB)]);
    const images = await defaultImages();

    const first = await runHashIndexBuild({ fetchImpl: makeFetch({ bulkBody, images }), limit: 1 });
    expect(first.hashed).toBe(1);

    const imageRequests: string[] = [];
    const second = await runHashIndexBuild({
      fetchImpl: makeFetch({ bulkBody, images, onImageRequest: (url) => imageRequests.push(url) }),
    });

    expect(second.hashed).toBe(1);
    expect(db.select().from(artworkHashes).all()).toHaveLength(2);
    // Only the artwork that was still outstanding.
    expect(imageRequests.every((url) => url.includes("/b.jpg"))).toBe(true);
  });

  it("retries a 429 and succeeds", async () => {
    const { runHashIndexBuild } = await import("./hash-index");

    const result = await runHashIndexBuild({
      fetchImpl: makeFetch({
        bulkBody: gzippedJsonl([artworkCard({})]),
        images: await defaultImages(),
        failures: new Map([["https://cards.scryfall.io/art_crop/a.jpg", [429, 503]]]),
      }),
    });

    expect(result.hashed).toBe(1);
  });

  it("gives up on an artwork after repeated failures without failing the run", async () => {
    const { runHashIndexBuild } = await import("./hash-index");

    const result = await runHashIndexBuild({
      fetchImpl: makeFetch({
        bulkBody: gzippedJsonl([artworkCard({}), artworkCard(cardB)]),
        images: await defaultImages(),
        failures: new Map([["https://cards.scryfall.io/art_crop/a.jpg", [500, 500, 500, 500]]]),
      }),
    });

    // One unreachable image is one lost artwork, not a lost multi-hour run.
    expect(result.hashed).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("does not retry a 404, which is permanent", async () => {
    const { runHashIndexBuild } = await import("./hash-index");

    const requests: string[] = [];
    const result = await runHashIndexBuild({
      fetchImpl: makeFetch({
        bulkBody: gzippedJsonl([artworkCard({})]),
        images: new Map(), // every image 404s
        onImageRequest: (url) => requests.push(url),
      }),
    });

    expect(result.skipped).toBe(1);
    expect(requests).toHaveLength(1);
  });

  it("keeps the art hash when only the full-card image fails", async () => {
    const { runHashIndexBuild } = await import("./hash-index");
    const { db } = await import("../db/client");
    const { artworkHashes } = await import("../db/schema");

    const images = await defaultImages();
    images.delete("https://cards.scryfall.io/small/a.jpg");

    const result = await runHashIndexBuild({
      fetchImpl: makeFetch({ bulkBody: gzippedJsonl([artworkCard({})]), images }),
    });

    expect(result.hashed).toBe(1);
    const row = db.select().from(artworkHashes).all()[0];
    // The art hash is the one the recognizer needs; losing the second must
    // not discard the first.
    expect(row?.artPhash).toHaveLength(8);
    expect(row?.fullPhash).toBeNull();
  });

  it("records an error in sync_state and rethrows when the bulk download fails", async () => {
    const { runHashIndexBuild } = await import("./hash-index");
    const { db } = await import("../db/client");
    const { syncState } = await import("../db/schema");

    const failing: typeof fetch = (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://api.scryfall.com/bulk-data") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  type: "unique_artwork",
                  updated_at: "2026-08-03T10:00:00Z",
                  jsonl_download_uri: "https://data.scryfall.io/unique-artwork/x.jsonl.gz",
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response("", { status: 500 }));
    };

    await expect(runHashIndexBuild({ fetchImpl: failing })).rejects.toThrow(/HTTP 500/);

    const state = db.select().from(syncState).all();
    expect(state[0]?.status).toBe("error");
    expect(state[0]?.errorMessage).toContain("HTTP 500");
  });
});

describe("propagation onto cards", () => {
  /**
   * The payoff of keying on artwork rather than printing: one hash computed
   * once lands on every reprint, including a printing that never appeared in
   * the `unique_artwork` file at all.
   */
  it("copies hashes onto every printing sharing an artwork", async () => {
    const { runHashIndexBuild } = await import("./hash-index");
    const { db } = await import("../db/client");
    const { cards } = await import("../db/schema");
    const { toCardRow } = await import("./card-row-mapper");
    const { scryfallCardSchema } = await import("@mtg/schemas");

    const now = new Date();
    for (const id of [CARD_A, CARD_A_REPRINT]) {
      const card = scryfallCardSchema.parse(artworkCard({ id }));
      db.insert(cards).values(toCardRow(card, now)).run();
    }

    await runHashIndexBuild({
      fetchImpl: makeFetch({
        bulkBody: gzippedJsonl([artworkCard({})]),
        images: await defaultImages(),
      }),
    });

    const rows = db.select().from(cards).all();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.illustrationId).toBe(ART_A);
      expect(row.artPhash).toHaveLength(8);
      expect(row.fullPhash).toHaveLength(8);
    }
    // Same artwork, therefore byte-identical hashes on both printings.
    expect(rows[0]?.artPhash?.equals(rows[1]?.artPhash ?? Buffer.alloc(0))).toBe(true);
  });

  it("leaves printings with no indexed artwork untouched", async () => {
    const { runHashIndexBuild } = await import("./hash-index");
    const { db } = await import("../db/client");
    const { cards } = await import("../db/schema");
    const { toCardRow } = await import("./card-row-mapper");
    const { scryfallCardSchema } = await import("@mtg/schemas");

    const unindexed = scryfallCardSchema.parse(artworkCard({ id: CARD_B, illustration_id: ART_B }));
    db.insert(cards).values(toCardRow(unindexed, new Date())).run();

    await runHashIndexBuild({
      fetchImpl: makeFetch({
        bulkBody: gzippedJsonl([artworkCard({})]),
        images: await defaultImages(),
      }),
    });

    const row = db.select().from(cards).all()[0];
    expect(row?.artPhash).toBeNull();
  });
});
