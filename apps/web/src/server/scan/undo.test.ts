import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scryfallIdSchema } from "@mtg/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

const scryfallId = scryfallIdSchema.parse("0000419b-0bba-4488-8f7a-6194544ce91e");

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-scan-undo-test-"));
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

async function seedCard() {
  const { db } = await import("../db/client");
  const { cards } = await import("../db/schema");
  const now = new Date();
  await db.insert(cards).values({
    id: scryfallId,
    oracleId: null,
    name: "Forest",
    layout: "normal",
    manaCost: "",
    cmc: 0,
    typeLine: "Basic Land — Forest",
    oracleText: null,
    colors: [],
    colorIdentity: ["G"],
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
    fullArt: true,
    textless: false,
    promo: false,
    variation: false,
    finishes: ["nonfoil", "foil"],
    cardFaces: null,
    imageUris: null,
    scryfallUri: "https://scryfall.com/card/blb/280/forest",
    prices: {},
    createdAt: now,
    updatedAt: now,
  });
}

describe("undoScanCommit", () => {
  it("decrements quantity when the stack still has copies", async () => {
    await seedCard();
    const { commitScan } = await import("./commit");
    const { undoScanCommit } = await import("./undo");
    const first = commitScan({
      scryfallId,
      finish: "nonfoil",
      condition: "NM",
      quantity: 1,
      isProxy: false,
      binderLocation: "",
      language: "en",
    });
    commitScan({
      scryfallId,
      finish: "nonfoil",
      condition: "NM",
      quantity: 1,
      isProxy: false,
      binderLocation: "",
      language: "en",
    });

    const result = undoScanCommit(first.item.id, 1);
    expect(result.outcome).toBe("decremented");
    if (result.outcome === "decremented") {
      expect(result.item.quantity).toBe(1);
    }
  });

  it("deletes the stack when undoing the last copy", async () => {
    await seedCard();
    const { commitScan } = await import("./commit");
    const { undoScanCommit } = await import("./undo");
    const { getCollectionItem } = await import("../collection/items");
    const committed = commitScan({
      scryfallId,
      finish: "foil",
      condition: "LP",
      quantity: 1,
      isProxy: false,
      binderLocation: "box-a",
      language: "en",
    });

    const result = undoScanCommit(committed.item.id, 1);
    expect(result).toEqual({
      outcome: "deleted",
      collectionItemId: committed.item.id,
    });
    expect(getCollectionItem(committed.item.id)).toBeUndefined();
  });

  it("returns not_found for an unknown item", async () => {
    const { undoScanCommit } = await import("./undo");
    expect(undoScanCommit("0000419b-0bba-4488-8f7a-6194544ce91e", 1)).toEqual({
      outcome: "not_found",
    });
  });
});
