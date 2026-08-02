import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-backup-test-"));
  process.env["DATABASE_PATH"] = join(dir, "test.db");
  process.env["DRIZZLE_MIGRATIONS_FOLDER"] = join(import.meta.dirname, "../../../drizzle");
  process.env["BACKUP_DIR"] = join(dir, "backups");
});

afterEach(() => {
  globalThis.__mtgSqlite?.close();
  globalThis.__mtgSqlite = undefined;
  globalThis.__mtgDb = undefined;
  rmSync(dir, { recursive: true, force: true });
  delete process.env["DATABASE_PATH"];
  delete process.env["DRIZZLE_MIGRATIONS_FOLDER"];
  delete process.env["BACKUP_DIR"];
});

async function seedCard(id: string) {
  const { db } = await import("../db/client");
  const { cards } = await import("../db/schema");
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

describe("runBackup", () => {
  it("produces a valid, independently-readable snapshot without stopping the live connection", async () => {
    const cardId = "0000419b-0bba-4488-8f7a-6194544ce91e";
    await seedCard(cardId);

    const { runBackup } = await import("./backup");
    const result = await runBackup();

    expect(existsSync(result.filePath)).toBe(true);
    expect(result.fileSizeBytes).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Open the backup file with a *separate* raw connection - proves it's
    // a complete, self-contained snapshot, not just a claim about the
    // return value. The original connection (from seedCard/db/client) is
    // still open the whole time this runs (AC1: no stopping the app).
    const backupDb = new Database(result.filePath, { readonly: true });
    try {
      const rows = backupDb.prepare("SELECT id, name FROM cards").all() as {
        id: string;
        name: string;
      }[];
      expect(rows).toEqual([{ id: cardId, name: "Forest" }]);
    } finally {
      backupDb.close();
    }
  });

  it("writes to BACKUP_DIR, creating it if necessary", async () => {
    await seedCard("0000419b-0bba-4488-8f7a-6194544ce91e");
    const { runBackup } = await import("./backup");
    const result = await runBackup();
    expect(result.filePath.startsWith(join(dir, "backups"))).toBe(true);
  });
});
