import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

// `import.meta.dirname` looks appealing here but Next's Turbopack SSR
// bundle leaves it `undefined` at runtime (confirmed by actually running
// `next dev`, not just the test suite, which uses vite-node and doesn't hit
// this) - process.cwd() is what Next.js itself guarantees (it's always run
// from the app directory), so that's the real default. Tests that run from
// the repo root override it via DRIZZLE_MIGRATIONS_FOLDER.
const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "mtg.db");
const MIGRATIONS_FOLDER =
  process.env["DRIZZLE_MIGRATIONS_FOLDER"] ?? path.join(process.cwd(), "drizzle");

function openSqlite(): Database.Database {
  const dbPath = process.env["DATABASE_PATH"] ?? DEFAULT_DB_PATH;
  // better-sqlite3 doesn't create the parent directory (e.g. a fresh
  // `data/` on first run, or a not-yet-mounted volume path in dev).
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  // WAL so the bulk sync job doesn't block reads from the rest of the app.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

// `next dev` re-evaluates modules on every HMR pass; cache the connection on
// globalThis so we don't open a second handle to the same WAL-mode file.
declare global {
  var __mtgSqlite: Database.Database | undefined;
  var __mtgDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

function getDb() {
  if (!globalThis.__mtgDb) {
    const sqlite = globalThis.__mtgSqlite ?? openSqlite();
    globalThis.__mtgSqlite = sqlite;
    const drizzleDb = drizzle(sqlite, { schema });
    migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });
    globalThis.__mtgDb = drizzleDb;
  }
  return globalThis.__mtgDb;
}

export const db = getDb();

/**
 * The raw better-sqlite3 handle, for operations Drizzle doesn't wrap (e.g.
 * the online backup API - server/backup/backup.ts). `getDb()` always
 * populates `globalThis.__mtgSqlite` as a side effect before this can be
 * called, since `db` above is initialized first in module evaluation order.
 */
export function getSqlite(): Database.Database {
  const sqlite = globalThis.__mtgSqlite;
  if (!sqlite) throw new Error("sqlite handle unavailable - getDb() should have set it");
  return sqlite;
}
