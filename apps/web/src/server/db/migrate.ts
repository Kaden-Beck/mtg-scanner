import { mkdirSync } from "node:fs";
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
// process.cwd()-based, matching client.ts - this script is always invoked
// with apps/web as the working directory (`db:migrate` script, container
// entrypoint).
const dbPath = process.env["DATABASE_PATH"] ?? path.join(process.cwd(), "data", "mtg.db");
const migrationsFolder =
  process.env["DRIZZLE_MIGRATIONS_FOLDER"] ?? path.join(process.cwd(), "drizzle");

mkdirSync(path.dirname(dbPath), { recursive: true });
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

const db = drizzle(sqlite, {});
migrate(db, { migrationsFolder });
sqlite.close();

console.log(`Migrations applied to ${dbPath}`);
