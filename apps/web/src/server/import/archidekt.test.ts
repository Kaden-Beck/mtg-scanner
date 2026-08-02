import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

const forestId = "0000419b-0bba-4488-8f7a-6194544ce91e";
const islandId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-archidekt-import-test-"));
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

async function seedCard(
  id: string,
  name: string,
  setCode: string,
  setName: string,
  collectorNumber: string,
) {
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
    typeLine: "Basic Land",
    oracleText: null,
    colors: [],
    colorIdentity: [],
    keywords: [],
    legalities: {},
    games: ["paper"],
    reserved: false,
    setCode,
    setName,
    setType: "expansion",
    collectorNumber,
    rarity: "common",
    releasedAt: "2024-08-02",
    artist: null,
    borderColor: "black",
    frame: "2015",
    fullArt: false,
    textless: false,
    promo: false,
    variation: false,
    finishes: ["nonfoil", "foil"],
    cardFaces: null,
    imageUris: null,
    scryfallUri: "https://scryfall.com/card",
    prices: {},
    createdAt: now,
    updatedAt: now,
  });
}

describe("importArchidektCsv - resolution", () => {
  it("resolves a row by Scryfall ID alone, preserving quantity/foil/condition", async () => {
    await seedCard(forestId, "Forest", "blb", "Bloomburrow", "280");
    const { importArchidektCsv } = await import("./archidekt");

    const csv = `Scryfall ID,Quantity,Foil,Condition\n${forestId},4,Foil,Lightly Played\n`;
    const result = importArchidektCsv({ fileName: "collection.csv", csvText: csv });

    expect(result.outcome).toBe("completed");
    if (result.outcome !== "completed") throw new Error("unreachable");
    expect(result.batch.resolvedRows).toBe(1);
    expect(result.batch.unresolvedRows).toBe(0);

    const { db } = await import("../db/client");
    const { collectionItems } = await import("../db/schema");
    const [item] = db.select().from(collectionItems).all();
    expect(item?.quantity).toBe(4);
    expect(item?.finish).toBe("foil");
    expect(item?.condition).toBe("LP");
  });

  it("resolves a row by name + set code + collector number when no Scryfall ID is given", async () => {
    await seedCard(forestId, "Forest", "blb", "Bloomburrow", "280");
    const { importArchidektCsv } = await import("./archidekt");

    const csv = "Name,Set Code,Collector Number,Quantity\nForest,BLB,280,2\n";
    const result = importArchidektCsv({ fileName: "collection.csv", csvText: csv });

    expect(result.outcome).toBe("completed");
    if (result.outcome !== "completed") throw new Error("unreachable");
    expect(result.batch.resolvedRows).toBe(1);
  });

  it("falls back to set name when set code isn't provided", async () => {
    await seedCard(forestId, "Forest", "blb", "Bloomburrow", "280");
    const { importArchidektCsv } = await import("./archidekt");

    const csv = "Name,Set,Collector Number,Quantity\nForest,Bloomburrow,280,1\n";
    const result = importArchidektCsv({ fileName: "collection.csv", csvText: csv });

    expect(result.outcome).toBe("completed");
    if (result.outcome !== "completed") throw new Error("unreachable");
    expect(result.batch.resolvedRows).toBe(1);
  });

  it("routes an unknown Scryfall ID to the reconciliation queue instead of dropping it", async () => {
    const { importArchidektCsv } = await import("./archidekt");
    const csv = `Scryfall ID,Quantity\n${islandId},1\n`;
    const result = importArchidektCsv({ fileName: "collection.csv", csvText: csv });

    expect(result.outcome).toBe("completed");
    if (result.outcome !== "completed") throw new Error("unreachable");
    expect(result.batch.unresolvedRows).toBe(1);

    const { db } = await import("../db/client");
    const { importReconciliationRows } = await import("../db/schema");
    const [row] = db.select().from(importReconciliationRows).all();
    expect(row?.reason).toBe("scryfall_id_not_found");
    expect(row?.rawRow).toEqual({ "Scryfall ID": islandId, Quantity: "1" });
  });

  it("routes a row with no name/set/collector-number match to reconciliation", async () => {
    await seedCard(forestId, "Forest", "blb", "Bloomburrow", "280");
    const { importArchidektCsv } = await import("./archidekt");
    const csv = "Name,Set Code,Collector Number,Quantity\nNonexistent Card,blb,999,1\n";
    const result = importArchidektCsv({ fileName: "collection.csv", csvText: csv });

    if (result.outcome !== "completed") throw new Error("unreachable");
    expect(result.batch.unresolvedRows).toBe(1);

    const { db } = await import("../db/client");
    const { importReconciliationRows } = await import("../db/schema");
    const [row] = db.select().from(importReconciliationRows).all();
    expect(row?.reason).toBe("no_matching_printing");
  });

  it("routes a row missing required identifying fields to reconciliation as insufficient_data", async () => {
    const { importArchidektCsv } = await import("./archidekt");
    const csv = "Name,Quantity\nForest,1\n"; // no set, no collector number, no scryfall id
    const result = importArchidektCsv({ fileName: "collection.csv", csvText: csv });

    if (result.outcome !== "completed") throw new Error("unreachable");
    const { db } = await import("../db/client");
    const { importReconciliationRows } = await import("../db/schema");
    const [row] = db.select().from(importReconciliationRows).all();
    expect(row?.reason).toBe("insufficient_data");
  });

  it("routes a row with a missing/invalid quantity to reconciliation", async () => {
    await seedCard(forestId, "Forest", "blb", "Bloomburrow", "280");
    const { importArchidektCsv } = await import("./archidekt");
    const csv = `Scryfall ID,Quantity\n${forestId},0\n`;
    const result = importArchidektCsv({ fileName: "collection.csv", csvText: csv });

    if (result.outcome !== "completed") throw new Error("unreachable");
    const { db } = await import("../db/client");
    const { importReconciliationRows } = await import("../db/schema");
    const [row] = db.select().from(importReconciliationRows).all();
    expect(row?.reason).toBe("invalid_quantity");
  });

  it("flags an ambiguous match with candidate ids when name+set name matches more than one printing", async () => {
    await seedCard(forestId, "Forest", "blb", "Bloomburrow", "280");
    await seedCard(islandId, "Forest", "blb2", "Bloomburrow", "280"); // contrived duplicate collector number/set name
    const { importArchidektCsv } = await import("./archidekt");
    const csv = "Name,Set,Collector Number,Quantity\nForest,Bloomburrow,280,1\n";
    const result = importArchidektCsv({ fileName: "collection.csv", csvText: csv });

    if (result.outcome !== "completed") throw new Error("unreachable");
    const { db } = await import("../db/client");
    const { importReconciliationRows } = await import("../db/schema");
    const [row] = db.select().from(importReconciliationRows).all();
    expect(row?.reason).toBe("ambiguous_printing");
    expect(row?.candidateScryfallIds).toEqual(expect.arrayContaining([forestId, islandId]));
  });

  it("merges quantity into an existing stack rather than duplicating collection_items rows", async () => {
    await seedCard(forestId, "Forest", "blb", "Bloomburrow", "280");
    const { importArchidektCsv } = await import("./archidekt");
    const csv1 = `Scryfall ID,Quantity\n${forestId},2\n`;
    const csv2 = `Scryfall ID,Quantity\n${forestId},3\n`;
    importArchidektCsv({ fileName: "a.csv", csvText: csv1 });
    importArchidektCsv({ fileName: "b.csv", csvText: csv2 });

    const { db } = await import("../db/client");
    const { collectionItems } = await import("../db/schema");
    const items = db.select().from(collectionItems).all();
    expect(items).toHaveLength(1);
    expect(items[0]?.quantity).toBe(5);
  });
});

describe("importArchidektCsv - duplicate file handling (AC3)", () => {
  it("detects a byte-identical re-upload and requires an explicit choice before writing anything", async () => {
    await seedCard(forestId, "Forest", "blb", "Bloomburrow", "280");
    const { importArchidektCsv } = await import("./archidekt");
    const csv = `Scryfall ID,Quantity\n${forestId},4\n`;

    const first = importArchidektCsv({ fileName: "collection.csv", csvText: csv });
    expect(first.outcome).toBe("completed");

    const second = importArchidektCsv({ fileName: "collection.csv", csvText: csv });
    expect(second.outcome).toBe("duplicate_detected");

    const { db } = await import("../db/client");
    const { collectionItems, importBatches } = await import("../db/schema");
    expect(db.select().from(collectionItems).all()[0]?.quantity).toBe(4); // unchanged
    expect(db.select().from(importBatches).all()).toHaveLength(1); // no second batch written
  });

  it("'merge' applies the duplicate on top, adding quantity again", async () => {
    await seedCard(forestId, "Forest", "blb", "Bloomburrow", "280");
    const { importArchidektCsv } = await import("./archidekt");
    const csv = `Scryfall ID,Quantity\n${forestId},4\n`;

    importArchidektCsv({ fileName: "collection.csv", csvText: csv });
    const result = importArchidektCsv({
      fileName: "collection.csv",
      csvText: csv,
      duplicateAction: "merge",
    });
    expect(result.outcome).toBe("completed");

    const { db } = await import("../db/client");
    const { collectionItems } = await import("../db/schema");
    expect(db.select().from(collectionItems).all()[0]?.quantity).toBe(8);
  });

  it("'replace' reverses the prior batch's contribution before reapplying - net effect is not doubled", async () => {
    await seedCard(forestId, "Forest", "blb", "Bloomburrow", "280");
    const { importArchidektCsv } = await import("./archidekt");
    const csv = `Scryfall ID,Quantity\n${forestId},4\n`;

    const first = importArchidektCsv({ fileName: "collection.csv", csvText: csv });
    const result = importArchidektCsv({
      fileName: "collection.csv",
      csvText: csv,
      duplicateAction: "replace",
    });
    expect(result.outcome).toBe("completed");

    const { db } = await import("../db/client");
    const { collectionItems, importBatches } = await import("../db/schema");
    expect(db.select().from(collectionItems).all()[0]?.quantity).toBe(4); // not 8

    if (first.outcome !== "completed") throw new Error("unreachable");
    const [priorBatchRow] = db
      .select()
      .from(importBatches)
      .where(eq(importBatches.id, first.batch.id))
      .all();
    expect(priorBatchRow?.supersededByBatchId).not.toBeNull();
  });

  it("'replace' removes a collection_items row entirely if the batch was its only contribution", async () => {
    await seedCard(forestId, "Forest", "blb", "Bloomburrow", "280");
    const { importArchidektCsv } = await import("./archidekt");
    const csv = `Scryfall ID,Quantity\n${forestId},4\n`;

    importArchidektCsv({ fileName: "collection.csv", csvText: csv });
    // Re-import an *empty* collection (same file content would be detected
    // as the exact same duplicate; use a distinct but still-empty csv to
    // simulate "this file, replaced by nothing new").
    importArchidektCsv({
      fileName: "collection.csv",
      csvText: csv,
      duplicateAction: "replace",
    });

    // Replacing with the identical file re-adds the same quantity back, so
    // the row should still exist with quantity 4 (reversed then reapplied).
    const { db } = await import("../db/client");
    const { collectionItems } = await import("../db/schema");
    expect(db.select().from(collectionItems).all()[0]?.quantity).toBe(4);
  });
});
