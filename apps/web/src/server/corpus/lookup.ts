import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { type CardRow, cards } from "../db/schema.ts";

/**
 * Card resolution for the corpus labeller (KAD-36).
 *
 * Offline: every lookup is against the local `cards` table, which the KAD-8
 * ingest already filled with ~104.7k printings. Labelling 400 photographs
 * should not depend on Scryfall being reachable, and more importantly should
 * not be rate-limited into a multi-hour job.
 */

export interface ResolvedCard {
  card: CardRow;
  /**
   * True when more than one printing shares this card's `illustration_id`.
   *
   * Computed rather than asked. It is the single field most likely to be got
   * wrong by hand and the one that matters most - pHash cannot separate two
   * printings that share an illustration, so this flag is what tells the
   * harness which failures are expected and which are real.
   */
  sharedArt: boolean;
}

/**
 * Set code + collector number identifies exactly one printing.
 *
 * Both are compared case-insensitively on the *stored* value, because
 * SQLite's default `=` is BINARY (see CLAUDE.md) and set codes are stored
 * lowercase while people read them off a card in uppercase. Collector
 * numbers are text, not integers - "168a", "★12" and leading zeroes are all
 * real, so no numeric coercion happens anywhere here.
 */
export function findPrinting(setCode: string, collectorNumber: string): ResolvedCard | null {
  const card = db
    .select()
    .from(cards)
    .where(
      and(
        eq(sql`lower(${cards.setCode})`, setCode.toLowerCase()),
        eq(sql`lower(${cards.collectorNumber})`, collectorNumber.toLowerCase()),
      ),
    )
    .get();

  if (!card) return null;
  return { card, sharedArt: hasSharedArt(card) };
}

/** Other printings using the same illustration. */
export function hasSharedArt(card: CardRow): boolean {
  if (card.illustrationId === null) return false;
  const other = db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.illustrationId, card.illustrationId), ne(cards.id, card.id)))
    .get();
  return other !== undefined;
}

/**
 * Suggestions when a set/number lookup misses - almost always a mistyped set
 * code, so the useful reply is "which sets contain a card with this number"
 * rather than a bare "not found".
 */
export function suggestSets(collectorNumber: string, limit = 8): string[] {
  return db
    .select({ setCode: cards.setCode, name: cards.name })
    .from(cards)
    .where(eq(sql`lower(${cards.collectorNumber})`, collectorNumber.toLowerCase()))
    .limit(limit)
    .all()
    .map((row) => `${row.setCode} (${row.name})`);
}

/** Printings of a card by name, for when the collector number is unreadable
 *  - old frames do not print one at all. */
export function findByName(name: string, limit = 10): CardRow[] {
  return db
    .select()
    .from(cards)
    .where(eq(sql`lower(${cards.name})`, name.toLowerCase()))
    .limit(limit)
    .all();
}
