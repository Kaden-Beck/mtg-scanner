import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { type CardRow, cards, type DeckRow, decks } from "../db/schema";
import { type Color, deriveColorIdentity } from "./color-identity";

/**
 * The DB-touching half of deck derivation, kept separate from
 * `color-identity.ts` so the rules themselves stay pure and cheap to test
 * (KAD-28).
 */

export interface DeckCommanders {
  commander: CardRow | null;
  partner: CardRow | null;
}

export function loadDeckCommanders(deck: DeckRow): DeckCommanders {
  const ids = [deck.commanderCardId, deck.partnerCardId].filter((id): id is string => id !== null);
  if (ids.length === 0) return { commander: null, partner: null };

  // One query for both rather than two round trips - and keying by id copes
  // with a deck that names the same printing in both slots, where two
  // separate `.get()` calls would just return it twice.
  const rows = db.select().from(cards).where(inArray(cards.id, ids)).all();
  const byId = new Map(rows.map((row) => [row.id, row]));

  return {
    commander: deck.commanderCardId ? (byId.get(deck.commanderCardId) ?? null) : null,
    partner: deck.partnerCardId ? (byId.get(deck.partnerCardId) ?? null) : null,
  };
}

/**
 * A deck's color identity, derived fresh on every read (KAD-28 AC1). Never
 * stored: a Scryfall erratum in a later bulk sync must take effect without
 * the user re-entering anything.
 */
export function deckColorIdentity(deck: DeckRow): Color[] {
  const { commander, partner } = loadDeckCommanders(deck);
  return deriveColorIdentity(commander, partner);
}

/** A deck row plus everything derived from it that a client needs. */
export interface HydratedDeck extends DeckRow {
  colorIdentity: Color[];
}

export function hydrateDeck(deck: DeckRow): HydratedDeck {
  return { ...deck, colorIdentity: deckColorIdentity(deck) };
}

export function hydrateDeckById(id: string): HydratedDeck | undefined {
  const deck = db.select().from(decks).where(eq(decks.id, id)).get();
  return deck ? hydrateDeck(deck) : undefined;
}
