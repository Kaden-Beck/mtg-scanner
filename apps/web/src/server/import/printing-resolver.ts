import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { type CardRow, cards } from "../db/schema";
import type { ParsedArchidektRow } from "./archidekt-columns";

export type PrintingResolution =
  | { outcome: "resolved"; card: CardRow }
  | {
      outcome: "unresolved";
      reason: "insufficient_data" | "scryfall_id_not_found" | "no_matching_printing";
    }
  | { outcome: "unresolved"; reason: "ambiguous_printing"; candidateIds: string[] };

/**
 * Resolution order matches Archidekt's own documented rule: a Scryfall ID
 * alone is authoritative; otherwise name + set + collector number must all
 * be present and agree on exactly one printing (KAD-13 AC1/AC2).
 */
export function resolvePrinting(row: ParsedArchidektRow): PrintingResolution {
  if (row.scryfallId) {
    const found = db.select().from(cards).where(eq(cards.id, row.scryfallId)).get();
    return found
      ? { outcome: "resolved", card: found }
      : { outcome: "unresolved", reason: "scryfall_id_not_found" };
  }

  if (!row.name || !row.collectorNumber || (!row.setCode && !row.setName)) {
    return { outcome: "unresolved", reason: "insufficient_data" };
  }

  const candidates = findCandidates(row);
  if (candidates.length === 0) return { outcome: "unresolved", reason: "no_matching_printing" };
  if (candidates.length > 1) {
    return {
      outcome: "unresolved",
      reason: "ambiguous_printing",
      candidateIds: candidates.map((c) => c.id),
    };
  }
  const [card] = candidates;
  if (!card) return { outcome: "unresolved", reason: "no_matching_printing" };
  return { outcome: "resolved", card };
}

/**
 * Prefers set code (exact, indexed via cards_set_collector_idx) and falls
 * back to set name (some exports use "Set"/"Edition" rather than a code) -
 * both branches still require the name to match, since collector number
 * alone repeats across sets.
 */
function findCandidates(row: ParsedArchidektRow): CardRow[] {
  const name = row.name;
  const collectorNumber = row.collectorNumber;
  if (!name || !collectorNumber) return [];

  if (row.setCode) {
    const bySetCode = db
      .select()
      .from(cards)
      .where(
        and(
          sql`lower(${cards.setCode}) = ${row.setCode.toLowerCase()}`,
          eq(cards.collectorNumber, collectorNumber),
        ),
      )
      .all()
      .filter((c) => c.name.toLowerCase() === name.toLowerCase());
    if (bySetCode.length > 0) return bySetCode;
  }

  if (row.setName) {
    return db
      .select()
      .from(cards)
      .where(eq(cards.collectorNumber, collectorNumber))
      .all()
      .filter(
        (c) =>
          c.name.toLowerCase() === name.toLowerCase() &&
          c.setName.toLowerCase() === row.setName?.toLowerCase(),
      );
  }

  return [];
}
