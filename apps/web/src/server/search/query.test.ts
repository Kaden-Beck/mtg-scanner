import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-fts-test-"));
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

async function seedCard(id: string, name: string, typeLine: string, oracleText: string | null) {
  const { db } = await import("../db/client");
  const { cards } = await import("../db/schema");
  const now = new Date();
  await db.insert(cards).values({
    id,
    oracleId: null,
    name,
    layout: "normal",
    manaCost: "",
    cmc: 0,
    typeLine,
    oracleText,
    colors: [],
    colorIdentity: [],
    keywords: [],
    legalities: {},
    games: ["paper"],
    reserved: false,
    setCode: "blb",
    setName: "Bloomburrow",
    setType: "expansion",
    collectorNumber: "280",
    rarity: "common",
    releasedAt: "2024-08-02",
    artist: null,
    borderColor: "black",
    frame: "2015",
    fullArt: false,
    textless: false,
    promo: false,
    variation: false,
    finishes: ["nonfoil"],
    cardFaces: null,
    imageUris: null,
    scryfallUri: "https://scryfall.com/card/blb/280",
    prices: {},
    createdAt: now,
    updatedAt: now,
  });
}

describe("rebuildCardsFts + searchCards", () => {
  it("finds a card by name after a rebuild", async () => {
    await seedCard(
      "0000419b-0bba-4488-8f7a-6194544ce91e",
      "Lightning Bolt",
      "Instant",
      "Deal 3 damage to any target.",
    );
    await seedCard(
      "11111111-1111-4111-8111-111111111111",
      "Forest",
      "Basic Land — Forest",
      "({T}: Add {G}.)",
    );

    const { rebuildCardsFts } = await import("./fts");
    rebuildCardsFts();

    const { searchCards } = await import("./query");
    const results = searchCards("Lightning");
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("Lightning Bolt");
  });

  it("matches on oracle text and type line, not just name", async () => {
    await seedCard(
      "0000419b-0bba-4488-8f7a-6194544ce91e",
      "Lightning Bolt",
      "Instant",
      "Deal 3 damage to any target.",
    );
    const { rebuildCardsFts } = await import("./fts");
    rebuildCardsFts();

    const { searchCards } = await import("./query");
    expect(searchCards("damage")).toHaveLength(1);
    expect(searchCards("Instant")).toHaveLength(1);
    expect(searchCards("gobbledygook")).toHaveLength(0);
  });

  it("reflects a re-sync with no manual step - stale rows drop out, new rows appear", async () => {
    const staleId = "0000419b-0bba-4488-8f7a-6194544ce91e";
    await seedCard(staleId, "Lightning Bolt", "Instant", "Deal 3 damage to any target.");
    const { rebuildCardsFts } = await import("./fts");
    rebuildCardsFts();

    const { searchCards } = await import("./query");
    expect(searchCards("Lightning")).toHaveLength(1);

    const { db } = await import("../db/client");
    const { cards } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    await db.delete(cards).where(eq(cards.id, staleId));
    await seedCard(
      "22222222-2222-4222-8222-222222222222",
      "Counterspell",
      "Instant",
      "Counter target spell.",
    );
    rebuildCardsFts();

    expect(searchCards("Lightning")).toHaveLength(0);
    expect(searchCards("Counterspell")).toHaveLength(1);
  });
});
