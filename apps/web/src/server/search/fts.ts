import { sql } from "drizzle-orm";
import { db } from "../db/client";

/**
 * Fully rebuilds the `cards_fts` shadow index from `cards` via FTS5's
 * built-in 'rebuild' command (KAD-10). Chosen over trigger-based incremental
 * sync because the bulk card sync (KAD-8) already replaces the relevant
 * rows in one batch job - a full rebuild after each sync is simpler than
 * keeping INSERT/UPDATE/DELETE triggers correct, and self-heals any rowid
 * drift in the external-content table.
 */
export function rebuildCardsFts(): void {
  db.run(sql`INSERT INTO cards_fts(cards_fts) VALUES ('rebuild')`);
}
