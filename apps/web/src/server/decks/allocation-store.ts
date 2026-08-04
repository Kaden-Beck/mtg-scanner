import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { cards, collectionItems, deckAllocations, deckCards, decks } from "../db/schema";
import {
  type AllocatableStack,
  type ContendedStack,
  type DeckClaim,
  detectConflicts,
  planAllocation,
} from "./allocation";
import { loadDeckOwnership } from "./hydrate";

/**
 * The DB half of KAD-33 - what actually puts rows in `deck_allocations`,
 * which shipped in KAD-26 as a stub with no behavior.
 *
 * Allocations are **reconciled, not incrementally maintained**:
 * `syncDeckAllocations` recomputes one deck's rows from scratch and is called
 * after any deck-card mutation. Incremental upkeep across add/update/remove/
 * merge is four code paths that can each drift out of agreement with the
 * deck; a single idempotent recompute cannot. A Commander deck is ~100
 * entries, so the cost of doing it the obviously-correct way is nil.
 */

/**
 * Maybe-board cards deliberately do not claim physical copies.
 *
 * A card the user is *considering* has no business making another deck look
 * conflicted - it would fire a warning about a real deck on the strength of
 * a shortlist. Same scoping as KAD-32's cost summary, for the same reason.
 */
function allocatableEntries(deckId: string) {
  return db
    .select({ entry: deckCards, card: cards })
    .from(deckCards)
    .innerJoin(cards, eq(deckCards.scryfallId, cards.id))
    .where(eq(deckCards.deckId, deckId))
    .all()
    .filter((row) => row.entry.board !== "maybe");
}

/** Every deck's claims on the given stacks, keyed by collection item id. */
function claimsByStack(collectionItemIds: string[]): Map<string, DeckClaim[]> {
  const result = new Map<string, DeckClaim[]>();
  if (collectionItemIds.length === 0) return result;

  const rows = db
    .select({
      collectionItemId: deckAllocations.collectionItemId,
      quantity: deckAllocations.quantity,
      deckId: decks.id,
      deckName: decks.name,
    })
    .from(deckAllocations)
    .innerJoin(decks, eq(deckAllocations.deckId, decks.id))
    .where(inArray(deckAllocations.collectionItemId, collectionItemIds))
    .all();

  for (const row of rows) {
    const claim: DeckClaim = {
      deckId: row.deckId,
      deckName: row.deckName,
      quantity: row.quantity,
    };
    const existing = result.get(row.collectionItemId);
    if (existing) existing.push(claim);
    else result.set(row.collectionItemId, [claim]);
  }
  return result;
}

/**
 * Recomputes one deck's allocations. Idempotent - running it twice against an
 * unchanged deck leaves the same rows.
 *
 * Entries are planned in a stable order and the running total is threaded
 * through, so two entries in the same deck that resolve to the same physical
 * stack (a deck holding two printings of one card) cannot both claim it.
 * That is the in-deck mirror of the cross-deck contention this whole story is
 * about, and it is easy to miss because it needs no second deck to reproduce.
 */
export function syncDeckAllocations(deckId: string): void {
  const items = allocatableEntries(deckId).map((row) => ({
    entry: row.entry,
    card: row.card,
  }));

  const ownership = loadDeckOwnership(items);

  // Other decks' claims are a fixed input to this deck's planning, so they
  // are read once *before* this deck's own rows are cleared.
  const candidateStackIds = [
    ...new Set(
      [...ownership.values()].flatMap((entry) => entry.stacks.map((s) => s.collectionItemId)),
    ),
  ];
  const otherClaims = new Map<string, number>();
  for (const [stackId, claims] of claimsByStack(candidateStackIds)) {
    const total = claims
      .filter((claim) => claim.deckId !== deckId)
      .reduce((sum, claim) => sum + claim.quantity, 0);
    otherClaims.set(stackId, total);
  }

  // Claimed by this deck so far, so a second entry resolving to the same
  // stack sees it as already spoken for.
  const selfClaims = new Map<string, number>();
  const totals = new Map<string, number>();

  const ordered = [...items].sort((a, b) => a.entry.id.localeCompare(b.entry.id));
  for (const item of ordered) {
    const entryOwnership = ownership.get(item.entry.id);
    if (!entryOwnership) continue;

    const stacks: AllocatableStack[] = entryOwnership.stacks.map((stack) => ({
      collectionItemId: stack.collectionItemId,
      quantity: stack.quantity,
      claimedByOthers:
        (otherClaims.get(stack.collectionItemId) ?? 0) +
        (selfClaims.get(stack.collectionItemId) ?? 0),
    }));

    for (const planned of planAllocation(item.entry.quantity, stacks)) {
      selfClaims.set(
        planned.collectionItemId,
        (selfClaims.get(planned.collectionItemId) ?? 0) + planned.quantity,
      );
      totals.set(
        planned.collectionItemId,
        (totals.get(planned.collectionItemId) ?? 0) + planned.quantity,
      );
    }
  }

  const now = new Date();
  const rows = [...totals.entries()].map(([collectionItemId, quantity]) => ({
    id: randomUUID(),
    deckId,
    collectionItemId,
    quantity,
    createdAt: now,
    updatedAt: now,
  }));

  // One transaction so a deck is never observed with its old allocations
  // deleted and its new ones not yet written.
  db.transaction((tx) => {
    tx.delete(deckAllocations).where(eq(deckAllocations.deckId, deckId)).run();
    if (rows.length > 0) tx.insert(deckAllocations).values(rows).run();
  });
}

/**
 * Reconciles every deck. Returns how many it touched.
 *
 * Needed because allocations are written on deck-card *mutation*, so a deck
 * that has not been edited since KAD-33 landed has none - and a deck nobody
 * touches is exactly the built-and-shelved deck most worth knowing about
 * when a new brew wants its cards.
 *
 * Also the repair path for the one staleness case the read side cannot cover
 * on its own: conflicts are computed against live `collection_items`
 * quantities, so *shrinking* a stack surfaces correctly with no re-sync, but
 * *growing* one (or adding a new stack of a card decks already fight over)
 * leaves the old, tighter plan in place until something re-runs this.
 * Tracked as KAD-61.
 */
export function syncAllDeckAllocations(): number {
  const ids = db.select({ id: decks.id }).from(decks).all();
  for (const { id } of ids) syncDeckAllocations(id);
  return ids.length;
}

/**
 * Conflicts for every entry in a deck (KAD-33 AC2), keyed by `deckCards.id`.
 *
 * Read-time, per ADR-004 - there is no write-time constraint to lean on, so
 * this is the *only* thing that tells the user two decks want the same copy.
 */
export function loadDeckConflicts(deckId: string): Map<string, ContendedStack[]> {
  const result = new Map<string, ContendedStack[]>();

  const items = allocatableEntries(deckId).map((row) => ({ entry: row.entry, card: row.card }));
  if (items.length === 0) return result;

  const ownership = loadDeckOwnership(items);
  const stackIds = [
    ...new Set(
      [...ownership.values()].flatMap((entry) => entry.stacks.map((s) => s.collectionItemId)),
    ),
  ];
  if (stackIds.length === 0) return result;

  const claims = claimsByStack(stackIds);
  const quantities = new Map(
    db
      .select({ id: collectionItems.id, quantity: collectionItems.quantity })
      .from(collectionItems)
      .where(inArray(collectionItems.id, stackIds))
      .all()
      .map((row) => [row.id, row.quantity]),
  );

  // Only the stacks this deck is actually allocated against - an entry that
  // resolves to three stacks but only draws on one must not inherit the
  // other two's contention. Read once, not per entry.
  const allocated = new Set(
    db
      .select({ collectionItemId: deckAllocations.collectionItemId })
      .from(deckAllocations)
      .where(eq(deckAllocations.deckId, deckId))
      .all()
      .map((row) => row.collectionItemId),
  );

  for (const item of items) {
    const entryOwnership = ownership.get(item.entry.id);
    if (!entryOwnership) continue;

    const stacks = entryOwnership.stacks
      .filter((stack) => allocated.has(stack.collectionItemId))
      .map((stack) => ({
        collectionItemId: stack.collectionItemId,
        stackQuantity: quantities.get(stack.collectionItemId) ?? stack.quantity,
        claims: claims.get(stack.collectionItemId) ?? [],
      }));

    const conflicts = detectConflicts(deckId, stacks);
    if (conflicts.length > 0) result.set(item.entry.id, conflicts);
  }

  return result;
}
