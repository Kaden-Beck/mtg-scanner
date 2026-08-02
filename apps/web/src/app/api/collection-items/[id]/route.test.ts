import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

const scryfallId = "0000419b-0bba-4488-8f7a-6194544ce91e";

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-collection-items-id-test-"));
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

async function seedCollectionItem() {
  const { db } = await import("@/server/db/client");
  const { cards, collectionItems } = await import("@/server/db/schema");
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
  const id = "22222222-2222-2222-2222-222222222222";
  await db.insert(collectionItems).values({
    id,
    scryfallId,
    finish: "nonfoil",
    condition: "NM",
    quantity: 3,
    isProxy: false,
    binderLocation: "",
    language: "en",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

// GET's first line is `await connection()`, which requires Next's real
// request-scoped AsyncLocalStorage and throws when invoked directly like
// this - see the equivalent note in ../route.test.ts. getCollectionItem is
// covered directly in server/collection/items.test.ts.

describe("PATCH /api/collection-items/[id]", () => {
  it("updates the given fields", async () => {
    const id = await seedCollectionItem();
    const { PATCH } = await import("./route");
    const response = await PATCH(
      new NextRequest(`http://localhost/api/collection-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ quantity: 10 }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { item: { quantity: number } };
    expect(body.item.quantity).toBe(10);
  });

  it("returns 409 when the patch collides with a different existing stack", async () => {
    const id = await seedCollectionItem();
    const { db } = await import("@/server/db/client");
    const { collectionItems } = await import("@/server/db/schema");
    const now = new Date();
    await db.insert(collectionItems).values({
      id: "33333333-3333-3333-3333-333333333333",
      scryfallId,
      finish: "foil",
      condition: "NM",
      quantity: 1,
      isProxy: false,
      binderLocation: "",
      language: "en",
      createdAt: now,
      updatedAt: now,
    });

    const { PATCH } = await import("./route");
    const response = await PATCH(
      new NextRequest(`http://localhost/api/collection-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ finish: "foil" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(response.status).toBe(409);
  });

  it("returns 400 for an empty patch", async () => {
    const id = await seedCollectionItem();
    const { PATCH } = await import("./route");
    const response = await PATCH(
      new NextRequest(`http://localhost/api/collection-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/collection-items/[id]", () => {
  it("deletes the item", async () => {
    const id = await seedCollectionItem();
    const { DELETE } = await import("./route");
    const response = await DELETE(
      new NextRequest(`http://localhost/api/collection-items/${id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id }) },
    );
    expect(response.status).toBe(204);

    const { getCollectionItem } = await import("@/server/collection/items");
    expect(getCollectionItem(id)).toBeUndefined();
  });

  it("returns 404 for an unknown id", async () => {
    const { DELETE } = await import("./route");
    const response = await DELETE(
      new NextRequest("http://localhost/api/collection-items/nope", { method: "DELETE" }),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(response.status).toBe(404);
  });
});
