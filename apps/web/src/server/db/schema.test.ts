import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface IndexListRow {
  name: string;
}
interface TableInfoRow {
  name: string;
}

let dir: string;
let sqlite: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mtg-scanner-db-test-"));
  sqlite = new Database(join(dir, "test.db"));
  sqlite.pragma("journal_mode = WAL");
  migrate(drizzle(sqlite, {}), { migrationsFolder: join(import.meta.dirname, "../../../drizzle") });
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("initial migration", () => {
  it("enables WAL mode so the bulk sync doesn't block reads", () => {
    const [row] = sqlite.pragma("journal_mode") as { journal_mode: string }[];
    expect(row?.journal_mode).toBe("wal");
  });

  it("creates the cards table with the required columns", () => {
    const columns = (sqlite.pragma("table_info(cards)") as TableInfoRow[]).map((c) => c.name);
    for (const expected of [
      "id",
      "oracle_id",
      "name",
      "set_code",
      "collector_number",
      "art_phash",
      "full_phash",
    ]) {
      expect(columns).toContain(expected);
    }
  });

  it("creates the required cards indexes", () => {
    const indexes = (sqlite.pragma("index_list(cards)") as IndexListRow[]).map((i) => i.name);
    expect(indexes).toContain("cards_oracle_id_idx");
    expect(indexes).toContain("cards_name_idx");
    expect(indexes).toContain("cards_set_collector_idx");
  });

  it("creates the sync_state table", () => {
    const columns = (sqlite.pragma("table_info(sync_state)") as TableInfoRow[]).map((c) => c.name);
    expect(columns).toEqual(
      expect.arrayContaining([
        "sync_type",
        "status",
        "row_count",
        "source_timestamp",
        "last_synced_at",
      ]),
    );
  });

  it("is idempotent - re-running the migrator on an already-migrated db is a no-op", () => {
    expect(() => {
      migrate(drizzle(sqlite, {}), {
        migrationsFolder: join(import.meta.dirname, "../../../drizzle"),
      });
    }).not.toThrow();
  });
});
