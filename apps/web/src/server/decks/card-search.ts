import type { CardRow } from "../db/schema";
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
}

export function toSuggestion(card: CardRow): CardSuggestion {
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

export function suggestCards(raw: string, limit = 15): CardSuggestion[] {
  const query = toPrefixQuery(raw);
  if (!query) return [];
  return searchCards(query, limit).map(toSuggestion);
}
