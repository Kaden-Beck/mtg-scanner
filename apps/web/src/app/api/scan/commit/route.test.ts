import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

const scryfallId = "0000419b-0bba-4488-8f7a-6194544ce91e";

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-scan-commit-test-"));
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

describe("POST /api/scan/commit", () => {
  it("creates a new collection stack", async () => {
    await seedCard();
    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost/api/scan/commit", {
      method: "POST",
      body: JSON.stringify({ scryfallId, finish: "nonfoil" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      item: { scryfallId: string; quantity: number; condition: string; finish: string };
    };
    expect(body.item.scryfallId).toBe(scryfallId);
    expect(body.item.quantity).toBe(1);
    expect(body.item.condition).toBe("NM");
  });

  it("merges quantity on a second scan of the same stack", async () => {
    await seedCard();
    const { POST } = await import("./route");
    const payload = { scryfallId, finish: "foil", condition: "LP", quantity: 1 };
    const first = await POST(
      new NextRequest("http://localhost/api/scan/commit", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
    expect(first.status).toBe(201);
    const second = await POST(
      new NextRequest("http://localhost/api/scan/commit", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
    expect(second.status).toBe(201);
    const body = (await second.json()) as { item: { quantity: number; finish: string } };
    expect(body.item.quantity).toBe(2);
    expect(body.item.finish).toBe("foil");
  });

  it("returns 404 for an unknown printing", async () => {
    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost/api/scan/commit", {
      method: "POST",
      body: JSON.stringify({
        scryfallId: "0000419b-0bba-4488-8f7a-6194544ce91e",
        finish: "nonfoil",
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(404);
  });
});
