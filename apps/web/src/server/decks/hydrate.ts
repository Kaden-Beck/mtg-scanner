import { eq, inArray, or } from "drizzle-orm";
import { db } from "../db/client";
import { type CardRow, cards, collectionItems, type DeckRow, deckCards, decks } from "../db/schema";
import { type Color, deriveColorIdentity } from "./color-identity";
import { type DeckForValidation, type LegalityResult, validateDeck } from "./legality";
import { type EntryOwnership, type OwnedStack, resolveEntryOwnership } from "./ownership";

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

/**
 * Assembles the whole deck for the legality engine (KAD-30) in one join.
 *
 * The join is what makes AC3 work: `legalities` is read off the live `cards`
 * row at validate time, so a banlist change arriving in a bulk sync is
 * reflected with no user action. Nothing is denormalized onto `deck_cards`.
 */
export function loadDeckForValidation(deck: DeckRow): DeckForValidation {
  const { commander, partner } = loadDeckCommanders(deck);

  const rows = db
    .select({ entry: deckCards, card: cards })
    .from(deckCards)
    .innerJoin(cards, eq(deckCards.scryfallId, cards.id))
    .where(eq(deckCards.deckId, deck.id))
    .all();

  return {
    format: deck.format,
    commander,
    partner,
    entries: rows.map((row) => ({
      card: row.card,
      quantity: row.entry.quantity,
      board: row.entry.board,
    })),
  };
}

export function validateDeckById(id: string): LegalityResult | undefined {
  const deck = db.select().from(decks).where(eq(decks.id, id)).get();
  return deck ? validateDeck(loadDeckForValidation(deck)) : undefined;
}

/** What `loadDeckOwnership` needs off each deck entry - structural rather
 *  than the app's `DeckEntryView`, so `server/` doesn't import from `app/`. */
export interface OwnershipInput {
  entry: { id: string; scryfallId: string; quantity: number };
  card: CardRow;
}

/**
 * Ownership for every entry in a deck (KAD-32), keyed by `deckCards.id`.
 *
 * Matching is at **oracle** level, not printing level: in paper any printing
 * of Sol Ring goes in the deck, so restricting to the exact `scryfall_id`
 * would report a card as unowned while a copy sits in the box. The exact
 * printing is still distinguished on each stack (`exactPrinting`) so the UI
 * can say "you own this, but a different art".
 *
 * One query for the whole deck rather than one per card. A Commander deck is
 * ~100 entries, so this binds ~200 parameters worst case - well inside
 * SQLite's limit, but it is the reason the ids are deduped first (see the
 * `cards` batch-size note in CLAUDE.md for what happens when that stops
 * being true).
 */
export function loadDeckOwnership(items: OwnershipInput[]): Map<string, EntryOwnership> {
  const result = new Map<string, EntryOwnership>();
  if (items.length === 0) return result;

  const scryfallIds = [...new Set(items.map((item) => item.entry.scryfallId))];
  const oracleIds = [
    ...new Set(items.map((item) => item.card.oracleId).filter((id): id is string => id !== null)),
  ];

  // `inArray` with an empty array compiles to invalid SQL, so each side of
  // the OR is only included when it has values. `oracleIds` can legitimately
  // be empty - `cards.oracle_id` is nullable.
  const filters = [
    inArray(collectionItems.scryfallId, scryfallIds),
    ...(oracleIds.length > 0 ? [inArray(cards.oracleId, oracleIds)] : []),
  ];

  const rows = db
    .select({ stack: collectionItems, oracleId: cards.oracleId })
    .from(collectionItems)
    .innerJoin(cards, eq(collectionItems.scryfallId, cards.id))
    .where(or(...filters))
    .all();

  const byOracle = new Map<string, typeof rows>();
  const byScryfall = new Map<string, typeof rows>();
  for (const row of rows) {
    if (row.oracleId !== null) push(byOracle, row.oracleId, row);
    push(byScryfall, row.stack.scryfallId, row);
  }

  for (const item of items) {
    // Oracle id is the key when there is one; a card without one (Scryfall
    // leaves it off some non-card objects) can only be matched on its own
    // printing, which is the correct conservative answer rather than a crash.
    const matches =
      item.card.oracleId !== null
        ? (byOracle.get(item.card.oracleId) ?? [])
        : (byScryfall.get(item.entry.scryfallId) ?? []);

    const stacks: OwnedStack[] = matches.map((row) => ({
      collectionItemId: row.stack.id,
      scryfallId: row.stack.scryfallId,
      quantity: row.stack.quantity,
      finish: row.stack.finish,
      condition: row.stack.condition,
      binderLocation: row.stack.binderLocation,
      isProxy: row.stack.isProxy,
      exactPrinting: row.stack.scryfallId === item.entry.scryfallId,
    }));

    result.set(item.entry.id, resolveEntryOwnership(item.entry.quantity, stacks));
  }

  return result;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}
