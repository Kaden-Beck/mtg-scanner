import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

const scryfallId = "0000419b-0bba-4488-8f7a-6194544ce91e";

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-scan-resolve-unit-"));
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

describe("resolvePrinting", () => {
  it("returns the local printing without a network call", async () => {
    const { db } = await import("../db/client");
    const { cards } = await import("../db/schema");
    const now = new Date();
    await db.insert(cards).values({
      id: scryfallId,
      oracleId: null,
      name: "Lightning Bolt",
      layout: "normal",
      manaCost: "{R}",
      cmc: 1,
      typeLine: "Instant",
      oracleText: null,
      colors: ["R"],
      colorIdentity: ["R"],
      keywords: [],
      legalities: {},
      games: ["paper"],
      reserved: false,
      setCode: "lea",
      setName: "Limited Edition Alpha",
      setType: "core",
      collectorNumber: "161",
      rarity: "common",
      releasedAt: "1993-08-05",
      artist: null,
      borderColor: "black",
      frame: "1993",
      fullArt: false,
      textless: false,
      promo: false,
      variation: false,
      finishes: ["nonfoil"],
      cardFaces: null,
      imageUris: null,
      scryfallUri: "https://scryfall.com/card/lea/161/lightning-bolt",
      prices: {},
      createdAt: now,
      updatedAt: now,
    });

    const { resolvePrinting } = await import("./resolve");
    const result = resolvePrinting("LEA", "161");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.card.name).toBe("Lightning Bolt");
      expect(result.card.scryfallId).toBe(scryfallId);
    }
  });
});
