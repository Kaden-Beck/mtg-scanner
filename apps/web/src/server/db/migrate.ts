import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Standalone migration runner - used by the container entrypoint (KAD-7) so
 * migrations apply before the server starts accepting traffic, rather than
 * racing the first request. `src/db/client.ts` also auto-migrates lazily for
 * `next dev`, so this is safe to run redundantly; drizzle's migrator tracks
 * applied migrations and no-ops on the rest.
 */
const dbPath = process.env["DATABASE_PATH"] ?? path.join(process.cwd(), "data", "mtg.db");
const migrationsFolder = path.join(process.cwd(), "drizzle");

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

const db = drizzle(sqlite, {});
migrate(db, { migrationsFolder });
sqlite.close();

console.log(`Migrations applied to ${dbPath}`);
