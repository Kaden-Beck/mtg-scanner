import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

const scryfallId = "0000419b-0bba-4488-8f7a-6194544ce91e";
const otherScryfallId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  // Same globalThis-reset dance as bulk-cards.test.ts (see CLAUDE.md) - both
  // `__mtgSqlite` and `__mtgDb` must be cleared and modules re-imported, or
  // a later test silently reuses the previous test's connection.
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-collection-items-test-"));
  process.env["DATABASE_PATH"] = join(dir, "test.db");
  process.env["DRIZZLE_MIGRATIONS_FOLDER"] = join(import.meta.dirname, "../../../../drizzle");
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

describe("POST /api/collection-items", () => {
  it("creates a new stack for a known card", async () => {
    await seedCard(scryfallId);
    const { POST } = await import("./route");

    const request = new NextRequest("http://localhost/api/collection-items", {
      method: "POST",
      body: JSON.stringify({ scryfallId, finish: "nonfoil", condition: "NM", quantity: 2 }),
      headers: { "content-type": "application/json" },
    });
    const response = await POST(request);
    expect(response.status).toBe(201);

    const body = (await response.json()) as { item: { quantity: number; binderLocation: string } };
    expect(body.item.quantity).toBe(2);
    expect(body.item.binderLocation).toBe(""); // defaulted, not null
  });

  it("merges quantity into the existing stack instead of creating a second row", async () => {
    await seedCard(scryfallId);
    const { POST } = await import("./route");
    const { listCollectionItems } = await import("@/server/collection/items");

    const post = () =>
      POST(
        new NextRequest("http://localhost/api/collection-items", {
          method: "POST",
          body: JSON.stringify({ scryfallId, finish: "nonfoil", condition: "NM", quantity: 2 }),
          headers: { "content-type": "application/json" },
        }),
      );
    await post();
    const second = await post();
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { item: { quantity: number } };
    expect(secondBody.item.quantity).toBe(4);

    expect(listCollectionItems()).toHaveLength(1);
  });

  it("returns 404 for a scryfallId that isn't in the card database", async () => {
    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost/api/collection-items", {
      method: "POST",
      body: JSON.stringify({
        scryfallId: otherScryfallId,
        finish: "nonfoil",
        condition: "NM",
        quantity: 1,
      }),
      headers: { "content-type": "application/json" },
    });
    const response = await POST(request);
    expect(response.status).toBe(404);
  });

  it("returns 400 for an invalid request body", async () => {
    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost/api/collection-items", {
      method: "POST",
      body: JSON.stringify({ scryfallId, finish: "not-a-finish", condition: "NM", quantity: 1 }),
      headers: { "content-type": "application/json" },
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});

// GET's first line is `await connection()`, which requires Next's real
// request-scoped AsyncLocalStorage and throws when a route handler is
// invoked directly like this - the same constraint that keeps
// server/sync/status.ts (KAD-9) out of vitest and behind Playwright only.
// The query logic GET delegates to is covered directly in
// server/collection/items.test.ts; dynamic (non-prerendered) rendering is
// verified by `next build` reporting this route as `ƒ Dynamic`.
