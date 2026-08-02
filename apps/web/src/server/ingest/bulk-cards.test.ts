import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

beforeEach(() => {
  // `db/client.ts` assigns its singleton at module-evaluation time, and ESM
  // caches that evaluation - resetting the module registry each test is
  // what makes the next `await import("../db/client")` actually re-run
  // `getDb()` against the fresh DATABASE_PATH below, instead of returning
  // the previous test's already-evaluated `db` binding.
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-ingest-test-"));
  process.env["DATABASE_PATH"] = join(dir, "test.db");
  // client.ts resolves migrations relative to process.cwd(), which Next.js
  // guarantees is apps/web at runtime - but this suite runs from the repo
  // root, so point it at the real folder explicitly.
  process.env["DRIZZLE_MIGRATIONS_FOLDER"] = join(import.meta.dirname, "../../../drizzle");
});

afterEach(() => {
  // The db client caches its connection on globalThis so `next dev`'s HMR
  // doesn't reopen the WAL file - undo that here so each test gets its own
  // fresh connection against its own temp DATABASE_PATH.
  globalThis.__mtgSqlite?.close();
  globalThis.__mtgSqlite = undefined;
  globalThis.__mtgDb = undefined;
  rmSync(dir, { recursive: true, force: true });
  delete process.env["DATABASE_PATH"];
  delete process.env["DRIZZLE_MIGRATIONS_FOLDER"];
});

const baseCard = {
  object: "card" as const,
  id: "0000419b-0bba-4488-8f7a-6194544ce91e",
  oracle_id: "b34bb2dc-c1af-4d77-b0b3-a0fb342a5fc6",
  name: "Forest",
  lang: "en",
  released_at: "2024-08-02",
  layout: "normal",
  mana_cost: "",
  cmc: 0,
  type_line: "Basic Land — Forest",
  oracle_text: "({T}: Add {G}.)",
  colors: [],
  color_identity: ["G"],
  keywords: [],
  legalities: { standard: "legal" },
  games: ["paper"],
  reserved: false,
  finishes: ["nonfoil", "foil"],
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
  scryfall_uri: "https://scryfall.com/card/blb/280/forest",
  prices: { usd: "0.31" },
};

const tokenCard = {
  ...baseCard,
  id: "11111111-1111-1111-1111-111111111111",
  name: "Bear Token",
  layout: "token",
  set_type: "token",
};

function gzippedJsonl(objects: unknown[]): Uint8Array {
  return new Uint8Array(
    gzipSync(Buffer.from(`${objects.map((o) => JSON.stringify(o)).join("\n")}\n`)),
  );
}

/** A plain ArrayBuffer-backed stream sidesteps Buffer/SharedArrayBuffer BodyInit friction. */
function toStreamBody(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function makeFetch(bulkBody: Uint8Array, sourceUpdatedAt: string): typeof fetch {
  const fetchImpl: typeof fetch = (input, _init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://api.scryfall.com/bulk-data") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              {
                type: "default_cards",
                updated_at: sourceUpdatedAt,
                jsonl_download_uri: "https://data.scryfall.io/default-cards/x.jsonl.gz",
              },
            ],
          }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(new Response(toStreamBody(bulkBody), { status: 200 }));
  };
  return fetchImpl;
}

describe("runCardSync", () => {
  it("upserts collectible cards, filters excluded layouts, and records sync_state", async () => {
    const { runCardSync } = await import("./bulk-cards");
    const { db } = await import("../db/client");
    const { cards, syncState } = await import("../db/schema");

    const fetchImpl = makeFetch(gzippedJsonl([baseCard, tokenCard]), "2026-08-02T09:09:45Z");
    const result = await runCardSync(fetchImpl);

    expect(result.rowCount).toBe(1); // token filtered out
    expect(result.sourceTimestamp).toBe("2026-08-02T09:09:45Z");

    const rows = db.select().from(cards).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Forest");

    const [sync] = db.select().from(syncState).where(eq(syncState.syncType, "cards")).all();
    expect(sync?.status).toBe("success");
    expect(sync?.rowCount).toBe(1);
  });

  it("is idempotent - re-running upserts instead of duplicating rows", async () => {
    const { runCardSync } = await import("./bulk-cards");
    const { db } = await import("../db/client");
    const { cards } = await import("../db/schema");

    const fetchImpl = makeFetch(gzippedJsonl([baseCard]), "2026-08-02T09:09:45Z");
    await runCardSync(fetchImpl);
    await runCardSync(fetchImpl);

    const rows = db.select().from(cards).all();
    expect(rows).toHaveLength(1);
  });

  it("picks up a changed field on re-sync (e.g. an updated price)", async () => {
    const { runCardSync } = await import("./bulk-cards");
    const { db } = await import("../db/client");
    const { cards } = await import("../db/schema");

    await runCardSync(makeFetch(gzippedJsonl([baseCard]), "2026-08-02T09:09:45Z"));
    const updatedCard = { ...baseCard, prices: { usd: "1.23" } };
    await runCardSync(makeFetch(gzippedJsonl([updatedCard]), "2026-08-03T09:09:45Z"));

    const rows = db.select().from(cards).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.prices).toEqual({ usd: "1.23" });
  });

  it("records an error status without throwing away the previous success", async () => {
    const { runCardSync } = await import("./bulk-cards");
    const { db } = await import("../db/client");
    const { syncState } = await import("../db/schema");

    await runCardSync(makeFetch(gzippedJsonl([baseCard]), "2026-08-02T09:09:45Z"));

    const failingFetch: typeof fetch = () => Promise.resolve(new Response("nope", { status: 500 }));
    await expect(runCardSync(failingFetch)).rejects.toThrow();

    const [sync] = db.select().from(syncState).where(eq(syncState.syncType, "cards")).all();
    expect(sync?.status).toBe("error");
    expect(sync?.rowCount).toBe(1); // preserved from the earlier success
  });
});
