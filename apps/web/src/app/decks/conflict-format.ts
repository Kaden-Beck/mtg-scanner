import { type ContendedStack, competingDeckNames } from "@/server/decks/allocation";

/**
 * Presentation for allocation conflicts (KAD-33 AC2).
 *
 * Pure and separate from the page for the ADR-007 reason, same as
 * `legality-format.ts` and `ownership-format.ts`.
 *
 * Under ADR-004 nothing stops the user creating these, so this text is the
 * only thing that tells them a deck they think is built cannot actually be
 * sleeved up alongside their other decks. It always names a deck - "there is
 * a conflict" would be the allocation equivalent of "deck is illegal".
 */

/** How many competing decks to name before collapsing into a count. */
const MAX_NAMED_DECKS = 2;

export function conflictDeckNames(conflicts: ContendedStack[]): string[] {
  return competingDeckNames(conflicts);
}

/** "Also in Yeva", "Also in Yeva and Krenko", "Also in Yeva, Krenko and 2 more". */
export function conflictLine(conflicts: ContendedStack[]): string {
  const names = competingDeckNames(conflicts);
  if (names.length === 0) return "";

  if (names.length === 1) return `Also in ${String(names[0])}`;
  if (names.length === 2) return `Also in ${String(names[0])} and ${String(names[1])}`;

  const named = names.slice(0, MAX_NAMED_DECKS).join(", ");
  return `Also in ${named} and ${String(names.length - MAX_NAMED_DECKS)} more`;
}

/**
 * The accessible sentence. Spells out the shortfall the short line leaves
 * implicit - "Also in Yeva" does not, on its own, say that there are not
 * enough copies to go round.
 */
export function conflictLabel(cardName: string, conflicts: ContendedStack[]): string {
  const names = competingDeckNames(conflicts);
  if (names.length === 0) return "";

  const shortBy = conflicts.reduce((total, conflict) => total + conflict.shortBy, 0);
  const copies = shortBy === 1 ? "1 copy" : `${String(shortBy)} copies`;

  return `${cardName}: short ${copies}, also allocated to ${formatList(names)}`;
}

function formatList(names: string[]): string {
  if (names.length === 1) return String(names[0]);
  const last = names[names.length - 1];
  return `${names.slice(0, -1).join(", ")} and ${String(last)}`;
}

/** Deck-level count, for a summary that has to be reachable from anywhere
 *  ownership is claimed (the accepted cost recorded in ADR-004). */
export function conflictSummary(conflictsByEntry: Map<string, ContendedStack[]>): string {
  const entryCount = conflictsByEntry.size;
  if (entryCount === 0) return "";

  const deckNames = new Set<string>();
  for (const conflicts of conflictsByEntry.values()) {
    for (const name of competingDeckNames(conflicts)) deckNames.add(name);
  }

  const cards = entryCount === 1 ? "1 card" : `${String(entryCount)} cards`;
  const decks = deckNames.size === 1 ? "another deck" : `${String(deckNames.size)} other decks`;
  return `${cards} also allocated to ${decks}`;
}
