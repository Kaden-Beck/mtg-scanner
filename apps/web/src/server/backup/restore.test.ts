import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreFromBackup } from "./restore";

let dir: string;
let migrationsFolder: string;

const cardId = "0000419b-0bba-4488-8f7a-6194544ce91e";
const laterCardId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-restore-test-"));
  migrationsFolder = join(import.meta.dirname, "../../../drizzle");
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

async function openDbAt(dbPath: string) {
  vi.resetModules();
  globalThis.__mtgSqlite?.close();
  globalThis.__mtgSqlite = undefined;
  globalThis.__mtgDb = undefined;
  process.env["DATABASE_PATH"] = dbPath;
  process.env["DRIZZLE_MIGRATIONS_FOLDER"] = migrationsFolder;
  return import("../db/client");
}

async function seedCard(id: string, name: string) {
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
    setCode: "blb",
    setName: "Bloomburrow",
    setType: "expansion",
    collectorNumber: "280",
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

describe("restoreFromBackup (AC2 real round-trip)", () => {
  it("restores a fresh instance to exactly the backed-up state, including data written after the backup", async () => {
    const sourceDbPath = join(dir, "source.db");
    process.env["DATABASE_PATH"] = sourceDbPath;
    process.env["DRIZZLE_MIGRATIONS_FOLDER"] = migrationsFolder;
    process.env["BACKUP_DIR"] = join(dir, "backups");

    await seedCard(cardId, "Forest");
    const { runBackup } = await import("./backup");
    const backup = await runBackup();

    // Written to the source *after* the backup - proves the restored
    // instance reflects the backup's point-in-time state, not just
    // "whatever the source currently has" by coincidence.
    await seedCard(laterCardId, "Island");

    // "Restored to a fresh instance" (AC2) - a brand new DB path, not the
    // source path, gets initialized fresh (migrated, empty) then restored.
    const freshDbPath = join(dir, "fresh-instance.db");
    const fresh = await openDbAt(freshDbPath);
    fresh.getSqlite().close();
    globalThis.__mtgSqlite = undefined;
    globalThis.__mtgDb = undefined;

    restoreFromBackup(backup.filePath, freshDbPath);

    const restored = await openDbAt(freshDbPath);
    const { cards } = await import("../db/schema");
    const rows = restored.db.select().from(cards).all();

    expect(rows.map((r) => r.id).sort()).toEqual([cardId]);
    expect(rows[0]?.name).toBe("Forest");
  });

  it("throws if the backup file doesn't exist", () => {
    expect(() => {
      restoreFromBackup(join(dir, "nope.db"), join(dir, "dest.db"));
    }).toThrow(/not found/);
  });

  it("removes stale WAL/SHM sidecar files at the destination so old writes aren't replayed", async () => {
    const sourceDbPath = join(dir, "source.db");
    process.env["DATABASE_PATH"] = sourceDbPath;
    process.env["DRIZZLE_MIGRATIONS_FOLDER"] = migrationsFolder;
    process.env["BACKUP_DIR"] = join(dir, "backups");
    await seedCard(cardId, "Forest");
    const { runBackup } = await import("./backup");
    const backup = await runBackup();

    // A -wal/-shm pair sitting next to the destination, as SQLite leaves
    // behind for an un-checkpointed WAL-mode database - content doesn't
    // matter, only that restoreFromBackup removes them rather than leaving
    // them to be replayed against the freshly-restored main file.
    const destDbPath = join(dir, "dest.db");
    const { writeFileSync, existsSync } = await import("node:fs");
    writeFileSync(destDbPath, "");
    writeFileSync(`${destDbPath}-wal`, "stale wal content");
    writeFileSync(`${destDbPath}-shm`, "stale shm content");

    restoreFromBackup(backup.filePath, destDbPath);

    expect(existsSync(`${destDbPath}-wal`)).toBe(false);
    expect(existsSync(`${destDbPath}-shm`)).toBe(false);
  });
});
