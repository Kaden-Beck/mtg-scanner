import { eq, inArray, or } from "drizzle-orm";
import { db } from "../db/client";
import { type CardRow, cards, collectionItems, deckAllocations } from "../db/schema";
import { searchCards } from "../search/query";

/**
 * Typeahead for the deck editor (KAD-27).
 *
 * Deliberately a thin wrapper over the existing FTS search (KAD-10) rather
 * than a second search path - two implementations would drift, and the one
 * benchmarked at NFR-1 scale is this one.
 */

export interface CardSuggestion {
  id: string;
  name: string;
  setCode: string;
  collectorNumber: string;
  typeLine: string;
  manaCost: string | null;
  imageUri: string | null;
  /** Copies owned across every printing of this oracle card (KAD-35). */
  owned: number;
  /** Owned copies no other deck has claimed. Never negative. */
  free: number;
}

export function toSuggestion(card: CardRow, owned = 0, free = 0): CardSuggestion {
  return {
    id: card.id,
    name: card.name,
    setCode: card.setCode,
    collectorNumber: card.collectorNumber,
    typeLine: card.typeLine,
    manaCost: card.manaCost,
    // `small` for the list, `normal` for the hover preview; the list falls
    // back to whatever exists so a card with only one size still shows.
    imageUri: card.imageUris?.["normal"] ?? card.imageUris?.["small"] ?? null,
    owned,
    free,
  };
}

/**
 * FTS5 treats bare punctuation and unbalanced quotes as syntax, so raw user
 * keystrokes go in as a quoted prefix term rather than as a query. Without
 * this, typing `Sol "` throws mid-word instead of just finding nothing.
 */
export function toPrefixQuery(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const escaped = trimmed.replace(/"/g, '""');
  return `"${escaped}"*`;
}

export interface Availability {
  owned: number;
  free: number;
}

/**
 * Owned and unclaimed copies for each of the given cards, keyed by card id
 * (KAD-35).
 *
 * Counted at oracle level over the same join KAD-32's badge uses, so a card
 * and its reprints share one total instead of reporting per printing.
 *
 * `free` subtracts what *every* deck has allocated, not just other decks: a
 * copy the deck being edited already claimed for another entry is genuinely
 * not free for a new one, and treating it as free would offer the user a
 * card they have already spent.
 */
export function availabilityFor(rows: CardRow[]): Map<string, Availability> {
  const result = new Map<string, Availability>();
  if (rows.length === 0) return result;

  const cardIds = [...new Set(rows.map((row) => row.id))];
  const oracleIds = [
    ...new Set(rows.map((row) => row.oracleId).filter((id): id is string => id !== null)),
  ];

  // `inArray` with an empty array compiles to invalid SQL; `oracleIds` can
  // legitimately be empty since `cards.oracle_id` is nullable.
  const stackFilters = [
    inArray(collectionItems.scryfallId, cardIds),
    ...(oracleIds.length > 0 ? [inArray(cards.oracleId, oracleIds)] : []),
  ];

  const stacks = db
    .select({
      id: collectionItems.id,
      scryfallId: collectionItems.scryfallId,
      quantity: collectionItems.quantity,
      oracleId: cards.oracleId,
    })
    .from(collectionItems)
    .innerJoin(cards, eq(collectionItems.scryfallId, cards.id))
    .where(or(...stackFilters))
    .all();

  if (stacks.length === 0) {
    for (const row of rows) result.set(row.id, { owned: 0, free: 0 });
    return result;
  }

  const claimedByStack = new Map<string, number>();
  for (const allocation of db
    .select({
      collectionItemId: deckAllocations.collectionItemId,
      quantity: deckAllocations.quantity,
    })
    .from(deckAllocations)
    .where(
      inArray(
        deckAllocations.collectionItemId,
        stacks.map((stack) => stack.id),
      ),
    )
    .all()) {
    claimedByStack.set(
      allocation.collectionItemId,
      (claimedByStack.get(allocation.collectionItemId) ?? 0) + allocation.quantity,
    );
  }

  for (const row of rows) {
    const matching = stacks.filter((stack) =>
      row.oracleId !== null ? stack.oracleId === row.oracleId : stack.scryfallId === row.id,
    );
    const owned = matching.reduce((sum, stack) => sum + stack.quantity, 0);
    const claimed = matching.reduce((sum, stack) => sum + (claimedByStack.get(stack.id) ?? 0), 0);
    result.set(row.id, { owned, free: Math.max(0, owned - claimed) });
  }

  return result;
}

export interface SuggestOptions {
  limit?: number;
  /**
   * Restrict results to cards the user owns.
   *
   * Per ADR-004 this filters to *owned*, not *unallocated*. A copy already
   * promised to another deck is still a legal result - allocation is
   * advisory, so refusing to offer the card would enforce a reservation the
   * rest of the app deliberately does not. Claimed copies are pushed down the
   * ranking instead (see below), never removed.
   */
  ownedOnly?: boolean;
}

/**
 * De-prioritises fully-claimed cards without excluding them.
 *
 * A stable partition rather than a re-sort: FTS `rank` is relevance, and
 * throwing it away to sort by availability would answer a question the user
 * did not ask ("what is free?") instead of the one they did ("what am I
 * looking for?"). Within each group the relevance order is untouched.
 */
export function rankByAvailability(suggestions: CardSuggestion[]): CardSuggestion[] {
  return [
    ...suggestions.filter((card) => card.free > 0),
    ...suggestions.filter((card) => card.free === 0),
  ];
}

export function suggestCards(raw: string, options: SuggestOptions = {}): CardSuggestion[] {
  const { limit = 15, ownedOnly = false } = options;
  const query = toPrefixQuery(raw);
  if (!query) return [];

  const rows = searchCards(query, limit, ownedOnly);
  if (rows.length === 0) return [];

  const availability = availabilityFor(rows);
  const suggestions = rows.map((row) => {
    const entry = availability.get(row.id);
    return toSuggestion(row, entry?.owned ?? 0, entry?.free ?? 0);
  });

  // Only in owned-only mode. In the normal mode most results are unowned, so
  // every card would have free === 0 and the partition would be a no-op that
  // still cost a pass.
  return ownedOnly ? rankByAvailability(suggestions) : suggestions;
}
