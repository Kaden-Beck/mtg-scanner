import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "mtg.db");
const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

function openSqlite(): Database.Database {
  const dbPath = process.env["DATABASE_PATH"] ?? DEFAULT_DB_PATH;
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
