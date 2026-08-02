import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

const forestId = "0000419b-0bba-4488-8f7a-6194544ce91e";

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-import-route-test-"));
  process.env["DATABASE_PATH"] = join(dir, "test.db");
  process.env["DRIZZLE_MIGRATIONS_FOLDER"] = join(import.meta.dirname, "../../../../../drizzle");
});

afterEach(() => {
  globalThis.__mtgSqlite?.close();
  globalThis.__mtgSqlite = undefined;
  globalThis.__mtgDb = undefined;
  rmSync(dir, { recursive: true, force: true });
  delete process.env["DATABASE_PATH"];
  delete process.env["DRIZZLE_MIGRATIONS_FOLDER"];
});

async function seedCard(id: string) {
  const { db } = await import("@/server/db/client");
  const { cards } = await import("@/server/db/schema");
  const now = new Date();
  await db.insert(cards).values({
    id,
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

function postImport(body: unknown) {
  return import("./route").then(({ POST }) =>
    POST(
      new NextRequest("http://localhost/api/import/archidekt", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

describe("POST /api/import/archidekt", () => {
  it("imports a valid CSV and returns the batch", async () => {
    await seedCard(forestId);
    const response = await postImport({
      fileName: "collection.csv",
      csvText: `Scryfall ID,Quantity\n${forestId},4\n`,
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { batch: { resolvedRows: number } };
    expect(body.batch.resolvedRows).toBe(1);
  });

  it("returns 409 with the prior batch on a duplicate upload", async () => {
    await seedCard(forestId);
    const csvText = `Scryfall ID,Quantity\n${forestId},4\n`;
    await postImport({ fileName: "collection.csv", csvText });
    const second = await postImport({ fileName: "collection.csv", csvText });

    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string; priorBatch: { id: string } };
    expect(body.error).toBe("duplicate_import");
    expect(body.priorBatch.id).toBeTruthy();
  });

  it("proceeds when duplicateAction is provided", async () => {
    await seedCard(forestId);
    const csvText = `Scryfall ID,Quantity\n${forestId},4\n`;
    await postImport({ fileName: "collection.csv", csvText });
    const second = await postImport({
      fileName: "collection.csv",
      csvText,
      duplicateAction: "merge",
    });

    expect(second.status).toBe(201);
  });

  it("returns 400 for a malformed request body", async () => {
    const response = await postImport({ fileName: "collection.csv" }); // missing csvText
    expect(response.status).toBe(400);
  });
});
