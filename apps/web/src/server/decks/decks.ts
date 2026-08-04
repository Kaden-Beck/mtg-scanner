import { randomUUID } from "node:crypto";
import type {
  CreateDeckCardRequest,
  CreateDeckRequest,
  UpdateDeckCardRequest,
  UpdateDeckRequest,
} from "@mtg/schemas";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  cards,
  type DeckCardRow,
  type DeckRow,
  deckCards,
  decks,
  type NewDeckCardRow,
  type NewDeckRow,
} from "../db/schema";

export class CardNotFoundError extends Error {
  constructor(public readonly scryfallId: string) {
    super(`No card found for scryfallId ${scryfallId}`);
  }
}

export class DeckNotFoundError extends Error {
  constructor(public readonly deckId: string) {
    super(`No deck found for id ${deckId}`);
  }
}

function requireCard(scryfallId: string): void {
  const card = db.select({ id: cards.id }).from(cards).where(eq(cards.id, scryfallId)).get();
  if (!card) throw new CardNotFoundError(scryfallId);
}

export function listDecks(): DeckRow[] {
  return db.select().from(decks).all();
}

export function getDeck(id: string): DeckRow | undefined {
  return db.select().from(decks).where(eq(decks.id, id)).get();
}

export function createDeck(request: CreateDeckRequest): DeckRow {
  // Validated up front rather than leaning on the foreign key: a raw
  // SQLITE_CONSTRAINT_FOREIGNKEY can't tell the caller *which* of the two
  // card references was bad, and the route needs to say.
  if (request.commanderCardId) requireCard(request.commanderCardId);
  if (request.partnerCardId) requireCard(request.partnerCardId);

  const now = new Date();
  const row: NewDeckRow = {
    id: randomUUID(),
    name: request.name,
    format: request.format,
    description: request.description,
    commanderCardId: request.commanderCardId ?? null,
    partnerCardId: request.partnerCardId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(decks).values(row).run();
  const created = getDeck(row.id);
  if (!created) throw new Error("deck vanished immediately after insert");
  return created;
}

export function updateDeck(id: string, patch: UpdateDeckRequest): DeckRow | undefined {
  const existing = getDeck(id);
  if (!existing) return undefined;

  // `null` clears the reference and must survive to the UPDATE; only
  // `undefined` (the key absent from the patch) means "leave alone", which
  // is why this checks the key rather than truthiness.
  if (patch.commanderCardId) requireCard(patch.commanderCardId);
  if (patch.partnerCardId) requireCard(patch.partnerCardId);

  db.update(decks)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(decks.id, id))
    .run();

  const row = getDeck(id);
  if (!row) throw new Error("deck vanished immediately after update");
  return row;
}

export function deleteDeck(id: string): boolean {
  const existing = getDeck(id);
  if (!existing) return false;
  // deck_cards and deck_allocations cascade - which only actually fires
  // because db/client.ts sets `PRAGMA foreign_keys = ON`.
  db.delete(decks).where(eq(decks.id, id)).run();
  return true;
}

export function listDeckCards(deckId: string): DeckCardRow[] {
  return db.select().from(deckCards).where(eq(deckCards.deckId, deckId)).all();
}

export function getDeckCard(id: string): DeckCardRow | undefined {
  return db.select().from(deckCards).where(eq(deckCards.id, id)).get();
}

function findDeckCardEntry(
  deckId: string,
  scryfallId: string,
  board: CreateDeckCardRequest["board"],
): DeckCardRow | undefined {
  return db
    .select()
    .from(deckCards)
    .where(
      and(
        eq(deckCards.deckId, deckId),
        eq(deckCards.scryfallId, scryfallId),
        eq(deckCards.board, board),
      ),
    )
    .get();
}

/**
 * Adding a card already on the same board increments quantity instead of
 * creating a second entry - the `deck_cards_entry_idx` merge, mirroring
 * `createOrMergeCollectionItem`.
 *
 * A category supplied on a merge overwrites the existing one rather than
 * being ignored: the user just told us where this card belongs, and silently
 * keeping the old category would make the category picker look broken.
 */
export function addOrMergeDeckCard(deckId: string, request: CreateDeckCardRequest): DeckCardRow {
  if (!getDeck(deckId)) throw new DeckNotFoundError(deckId);
  requireCard(request.scryfallId);

  const now = new Date();
  const row: NewDeckCardRow = {
    id: randomUUID(),
    deckId,
    scryfallId: request.scryfallId,
    board: request.board,
    category: request.category,
    quantity: request.quantity,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(deckCards)
    .values(row)
    .onConflictDoUpdate({
      target: [deckCards.deckId, deckCards.scryfallId, deckCards.board],
      set: {
        quantity: sql`${deckCards.quantity} + excluded.quantity`,
        category: sql`excluded.category`,
        updatedAt: now,
      },
    })
    .run();

  const merged = findDeckCardEntry(deckId, request.scryfallId, request.board);
  if (!merged) throw new Error("deck card vanished immediately after upsert");
  return merged;
}

export type UpdateDeckCardResult =
  | { outcome: "updated"; row: DeckCardRow }
  | { outcome: "not_found" }
  | { outcome: "conflict" };

/**
 * Moving a card to a board it is already on collides with the entry index.
 * Reported as a conflict rather than silently merged, for the same reason
 * `updateCollectionItem` does: merging would have to combine quantities and
 * the caller never asked for that.
 */
export function updateDeckCard(id: string, patch: UpdateDeckCardRequest): UpdateDeckCardResult {
  const existing = getDeckCard(id);
  if (!existing) return { outcome: "not_found" };

  try {
    db.update(deckCards)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(deckCards.id, id))
      .run();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return { outcome: "conflict" };
    }
    throw error;
  }

  const row = getDeckCard(id);
  if (!row) throw new Error("deck card vanished immediately after update");
  return { outcome: "updated", row };
}

export function removeDeckCard(id: string): boolean {
  const existing = getDeckCard(id);
  if (!existing) return false;
  db.delete(deckCards).where(eq(deckCards.id, id)).run();
  return true;
}
