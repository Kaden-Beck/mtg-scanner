import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

const scryfallId = "0000419b-0bba-4488-8f7a-6194544ce91e";

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-scan-undo-route-test-"));
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

async function seedCard() {
  const { db } = await import("@/server/db/client");
  const { cards } = await import("@/server/db/schema");
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

describe("POST /api/scan/undo", () => {
  it("undoes a committed scan", async () => {
    await seedCard();
    const { POST: commit } = await import("../commit/route");
    const { POST: undo } = await import("./route");

    const committed = await commit(
      new NextRequest("http://localhost/api/scan/commit", {
        method: "POST",
        body: JSON.stringify({ scryfallId, finish: "nonfoil" }),
      }),
    );
    const commitBody = (await committed.json()) as {
      item: { id: string };
      quantityAdded: number;
    };
    expect(commitBody.quantityAdded).toBe(1);

    const response = await undo(
      new NextRequest("http://localhost/api/scan/undo", {
        method: "POST",
        body: JSON.stringify({
          collectionItemId: commitBody.item.id,
          quantityDelta: commitBody.quantityAdded,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { outcome: string };
    expect(body.outcome).toBe("deleted");
  });

  it("returns 404 when the stack is already gone", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/scan/undo", {
        method: "POST",
        body: JSON.stringify({
          collectionItemId: "0000419b-0bba-4488-8f7a-6194544ce91e",
          quantityDelta: 1,
        }),
      }),
    );
    expect(response.status).toBe(404);
  });
});
