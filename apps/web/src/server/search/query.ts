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
export function searchCards(query: string, limit = 50, ownedOnly = false): CardRow[] {
  // Applied inside the FTS query rather than by filtering its output: a
  // post-filter would have to over-fetch by an unknown factor (most of the
  // ~104.7k cards are not owned) and would still silently return short.
  //
  // Owned is matched at *oracle* level, the same rule as KAD-32's badge - a
  // deck can play any printing, so restricting to the exact `scryfall_id`
  // would hide cards the user demonstrably owns. The `ci.scryfall_id =
  // cards.id` arm covers cards with no oracle id, which cannot be matched
  // any other way.
  const ownedFilter = ownedOnly
    ? sql`AND EXISTS (
            SELECT 1 FROM collection_items ci
            JOIN cards owned_card ON owned_card.id = ci.scryfall_id
            WHERE ci.scryfall_id = cards.id
               OR (cards.oracle_id IS NOT NULL AND owned_card.oracle_id = cards.oracle_id)
          )`
    : sql``;

  const matches = db.all<{ id: string }>(sql`
    SELECT cards.id AS id
    FROM cards_fts
    JOIN cards ON cards.rowid = cards_fts.rowid
    WHERE cards_fts MATCH ${query}
    ${ownedFilter}
    ORDER BY rank
    LIMIT ${limit}
  `);
  if (matches.length === 0) return [];

  const ids = matches.map((match) => match.id);
  const rows = db.select().from(cards).where(inArray(cards.id, ids)).all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row) => row !== undefined);
}
