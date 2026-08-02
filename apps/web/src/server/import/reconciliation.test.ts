import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

const forestId = "0000419b-0bba-4488-8f7a-6194544ce91e";
const islandId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-reconciliation-test-"));
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

async function seedUnresolvedRow(): Promise<string> {
  const { importArchidektCsv } = await import("./archidekt");
  const result = importArchidektCsv({
    fileName: "collection.csv",
    csvText: `Scryfall ID,Quantity\n${islandId},2\n`, // islandId not seeded as a card -> unresolved
  });
  if (result.outcome !== "completed") throw new Error("unreachable");

  const { db } = await import("../db/client");
  const { importReconciliationRows } = await import("../db/schema");
  const [row] = db.select().from(importReconciliationRows).all();
  if (!row) throw new Error("expected a reconciliation row to have been created");
  return row.id;
}

describe("listOpenReconciliationRows", () => {
  it("returns unresolved rows with their original CSV values", async () => {
    await seedUnresolvedRow();
    const { listOpenReconciliationRows } = await import("./reconciliation");
    const rows = listOpenReconciliationRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rawRow).toEqual({ "Scryfall ID": islandId, Quantity: "2" });
    expect(rows[0]?.reason).toBe("scryfall_id_not_found");
  });

  it("excludes rows that have been resolved or dismissed", async () => {
    const rowId = await seedUnresolvedRow();
    await seedCard(islandId, "Island", "blb", "Bloomburrow", "281");
    const { resolveReconciliationRow, listOpenReconciliationRows } = await import(
      "./reconciliation"
    );
    resolveReconciliationRow(rowId, islandId);
    expect(listOpenReconciliationRows()).toHaveLength(0);
  });

  it("surfaces stored candidates for an ambiguous_printing row", async () => {
    await seedCard(forestId, "Forest", "blb", "Bloomburrow", "280");
    await seedCard(islandId, "Forest", "blb2", "Bloomburrow", "280");
    const { importArchidektCsv } = await import("./archidekt");
    importArchidektCsv({
      fileName: "collection.csv",
      csvText: "Name,Set,Collector Number,Quantity\nForest,Bloomburrow,280,1\n",
    });

    const { listOpenReconciliationRows } = await import("./reconciliation");
    const [row] = listOpenReconciliationRows();
    expect(row?.candidates.map((c) => c.id).sort()).toEqual([forestId, islandId].sort());
  });

  it("falls back to a fuzzy name search when there are no stored candidates", async () => {
    await seedCard(forestId, "Lightning Bolt", "blb", "Bloomburrow", "280");
    const { rebuildCardsFts } = await import("../search/fts");
    rebuildCardsFts();

    const { importArchidektCsv } = await import("./archidekt");
    importArchidektCsv({
      fileName: "collection.csv",
      csvText: "Name,Quantity\nLightning Bolt,1\n", // no set/collector number -> insufficient_data
    });

    const { listOpenReconciliationRows } = await import("./reconciliation");
    const [row] = listOpenReconciliationRows();
    expect(row?.reason).toBe("insufficient_data");
    expect(row?.candidates.map((c) => c.id)).toContain(forestId);
  });
});

describe("resolveReconciliationRow", () => {
  it("creates a collection_item from the row's original quantity/foil/condition", async () => {
    const rowId = await seedUnresolvedRow();
    await seedCard(islandId, "Island", "blb", "Bloomburrow", "281");

    const { resolveReconciliationRow } = await import("./reconciliation");
    const result = resolveReconciliationRow(rowId, islandId);
    expect(result.outcome).toBe("resolved");

    const { db } = await import("../db/client");
    const { collectionItems } = await import("../db/schema");
    const [item] = db.select().from(collectionItems).all();
    expect(item?.scryfallId).toBe(islandId);
    expect(item?.quantity).toBe(2);
  });

  it("returns not_found for an already-resolved row", async () => {
    const rowId = await seedUnresolvedRow();
    await seedCard(islandId, "Island", "blb", "Bloomburrow", "281");
    const { resolveReconciliationRow } = await import("./reconciliation");
    resolveReconciliationRow(rowId, islandId);
    expect(resolveReconciliationRow(rowId, islandId).outcome).toBe("not_found");
  });
});

describe("dismissReconciliationRows", () => {
  it("marks the given rows dismissed and excludes them from the open list", async () => {
    const rowId = await seedUnresolvedRow();
    const { dismissReconciliationRows, listOpenReconciliationRows } = await import(
      "./reconciliation"
    );
    const count = dismissReconciliationRows([rowId]);
    expect(count).toBe(1);
    expect(listOpenReconciliationRows()).toHaveLength(0);
  });

  it("only counts rows that were actually still open", async () => {
    const rowId = await seedUnresolvedRow();
    const { dismissReconciliationRows } = await import("./reconciliation");
    dismissReconciliationRows([rowId]);
    expect(dismissReconciliationRows([rowId])).toBe(0); // already dismissed
  });
});
