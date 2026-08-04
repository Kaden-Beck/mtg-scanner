import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

const forestId = "0000419b-0bba-4488-8f7a-6194544ce91e";
const unknownId = "8b4a3f2c-1d5e-4a7b-9c3d-2e6f8a0b1c4d";

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-import-json-route-test-"));
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

function exportFile(scryfallId: string) {
  return {
    version: 1,
    exportedAt: "2026-08-03T00:00:00.000Z",
    items: [
      {
        scryfallId,
        name: "Forest",
        setCode: "blb",
        setName: "Bloomburrow",
        collectorNumber: "280",
        quantity: 4,
        finish: "nonfoil",
        condition: "NM",
        isProxy: false,
        binderLocation: "box1",
        language: "en",
        tags: ["cube"],
      },
    ],
  };
}

function postImport(body: unknown) {
  return import("./route").then(({ POST }) =>
    POST(
      new NextRequest("http://localhost/api/import/collection", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

describe("POST /api/import/collection", () => {
  it("imports an export file and reports the count", async () => {
    await seedCard(forestId);
    const response = await postImport({ jsonText: JSON.stringify(exportFile(forestId)) });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { imported: number; skipped: unknown[] };
    expect(body.imported).toBe(1);
    expect(body.skipped).toEqual([]);
  });

  it("reports a row whose printing this database doesn't know, rather than dropping it", async () => {
    await seedCard(forestId);
    const response = await postImport({ jsonText: JSON.stringify(exportFile(unknownId)) });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      imported: number;
      skipped: { scryfallId: string; reason: string }[];
    };
    expect(body.imported).toBe(0);
    expect(body.skipped).toEqual([
      { scryfallId: unknownId, name: "Forest", reason: "printing_not_found" },
    ]);
  });

  // 422 rather than 400 is the contract: the request was fine, the file
  // inside it wasn't, and the client has a message worth showing.
  it("returns 422 with a message for a file that isn't an export", async () => {
    const response = await postImport({ jsonText: "Scryfall ID,Quantity\n" });

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe("invalid_file");
    expect(body.message).toContain("valid JSON");
  });

  it("returns 422 for an export version it doesn't understand", async () => {
    const response = await postImport({
      jsonText: JSON.stringify({ version: 99, exportedAt: "2026-08-03T00:00:00.000Z", items: [] }),
    });

    expect(response.status).toBe(422);
  });

  it("returns 400 for a malformed request body", async () => {
    const response = await postImport({}); // missing jsonText
    expect(response.status).toBe(400);
  });
});
