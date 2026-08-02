import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-price-refresh-test-"));
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

describe("runPriceRefresh", () => {
  it("updates only prices/updated_at on an existing row, never gameplay columns", async () => {
    const { runCardSync } = await import("./bulk-cards");
    await runCardSync(makeFetch(gzippedJsonl([baseCard]), "2026-08-01T00:00:00Z"));

    const { runPriceRefresh } = await import("./price-refresh");
    const { db } = await import("../db/client");
    const { cards } = await import("../db/schema");

    const updatedCard = { ...baseCard, name: "SHOULD NOT APPEAR", prices: { usd: "9.99" } };
    const result = await runPriceRefresh(
      makeFetch(gzippedJsonl([updatedCard]), "2026-08-02T00:00:00Z"),
    );

    expect(result.rowCount).toBe(1);
    const [row] = db.select().from(cards).where(eq(cards.id, baseCard.id)).all();
    expect(row?.prices).toEqual({ usd: "9.99" }); // price column updated
    expect(row?.name).toBe("Forest"); // gameplay column untouched
  });

  it("does not insert a row for a printing the card sync hasn't seen yet", async () => {
    const { runPriceRefresh } = await import("./price-refresh");
    await runPriceRefresh(makeFetch(gzippedJsonl([baseCard]), "2026-08-02T00:00:00Z"));

    const { db } = await import("../db/client");
    const { cards } = await import("../db/schema");
    expect(db.select().from(cards).all()).toHaveLength(0);
  });

  it("records sync_state under the prices sync type, independent of cards", async () => {
    const { runCardSync } = await import("./bulk-cards");
    await runCardSync(makeFetch(gzippedJsonl([baseCard]), "2026-08-01T00:00:00Z"));

    const { runPriceRefresh } = await import("./price-refresh");
    await runPriceRefresh(makeFetch(gzippedJsonl([baseCard]), "2026-08-02T00:00:00Z"));

    const { db } = await import("../db/client");
    const { syncState } = await import("../db/schema");
    const rows = db.select().from(syncState).all();
    const bySyncType = new Map(rows.map((row) => [row.syncType, row]));

    expect(bySyncType.get("prices")?.status).toBe("success");
    expect(bySyncType.get("prices")?.sourceTimestamp).toBe("2026-08-02T00:00:00Z");
    expect(bySyncType.get("cards")?.sourceTimestamp).toBe("2026-08-01T00:00:00Z"); // unaffected
  });

  it("records an error status on failure", async () => {
    const failingFetch: typeof fetch = () => Promise.resolve(new Response("nope", { status: 500 }));
    const { runPriceRefresh } = await import("./price-refresh");
    await expect(runPriceRefresh(failingFetch)).rejects.toThrow();

    const { db } = await import("../db/client");
    const { syncState } = await import("../db/schema");
    const [row] = db.select().from(syncState).where(eq(syncState.syncType, "prices")).all();
    expect(row?.status).toBe("error");
  });
});
