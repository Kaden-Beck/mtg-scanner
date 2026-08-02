import { inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { type CardRow, cards } from "../db/schema";

/**
 * Full-text search over `cards_fts` (KAD-10). Queries the FTS table for
 * matching rowids first, then re-fetches through the normal Drizzle
 * `cards` select so results come back fully typed (camelCase, JSON columns
 * parsed) instead of the raw snake_case shape a direct FTS5 join would
 * return - `db.all()` against raw SQL bypasses Drizzle's column mapping
 * entirely.
 */
export function searchCards(query: string, limit = 50): CardRow[] {
  const matches = db.all<{ id: string }>(sql`
    SELECT cards.id AS id
    FROM cards_fts
    JOIN cards ON cards.rowid = cards_fts.rowid
    WHERE cards_fts MATCH ${query}
    ORDER BY rank
    LIMIT ${limit}
  `);
  if (matches.length === 0) return [];

  const ids = matches.map((match) => match.id);
  const rows = db.select().from(cards).where(inArray(cards.id, ids)).all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row) => row !== undefined);
}
