import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

const scryfallId = "0000419b-0bba-4488-8f7a-6194544ce91e";

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-scan-resolve-test-"));
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
    oracleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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

describe("POST /api/scan/resolve", () => {
  it("resolves an exact set + collector number", async () => {
    await seedCard();
    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost/api/scan/resolve", {
      method: "POST",
      body: JSON.stringify({ setCode: "BLB", collectorNumber: "280" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.card.scryfallId).toBe(scryfallId);
    expect(body.card.name).toBe("Forest");
    expect(body.card.setCode).toBe("blb");
  });

  it("returns suggestions when the printing is missing", async () => {
    await seedCard();
    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost/api/scan/resolve", {
      method: "POST",
      body: JSON.stringify({ setCode: "xxx", collectorNumber: "280" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("not_found");
    expect(body.suggestions.some((s: string) => s.startsWith("blb"))).toBe(true);
  });

  it("rejects invalid bodies", async () => {
    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost/api/scan/resolve", {
      method: "POST",
      body: JSON.stringify({ setCode: "blb" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
