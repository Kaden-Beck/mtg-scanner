/**
 * Allocation planning and conflict detection (KAD-33), pure so the edge
 * cases the AC asks about are cheap to enumerate. The DB half is in
 * `allocation-store.ts`.
 *
 * Everything here follows from ADR-004: allocation is **advisory**. Nothing
 * in this module rejects, clamps, or refuses an allocation. Over-allocation
 * is a state to be *described* accurately, not prevented - so `planAllocation`
 * will happily claim more copies than exist, precisely so that
 * `detectConflicts` has something true to report.
 */

/** A stack this deck could draw on, with what other decks have already claimed. */
export interface AllocatableStack {
  collectionItemId: string;
  /** Physical copies in the stack. */
  quantity: number;
  /** Copies already claimed by *other* decks. May exceed `quantity`. */
  claimedByOthers: number;
}

export interface PlannedAllocation {
  collectionItemId: string;
  quantity: number;
}

/** Copies in a stack nobody else has spoken for. Never negative - a stack
 *  already over-committed has zero free capacity, not negative capacity. */
export function freeCapacity(stack: AllocatableStack): number {
  return Math.max(0, stack.quantity - stack.claimedByOthers);
}

/**
 * Chooses which physical stacks this deck's copies come from.
 *
 * Prefers stacks with the most *uncontested* capacity rather than simply the
 * largest or the first. Greedily taking stack #1 every time would make four
 * decks all claim the same copy while an identical one sat free two rows
 * down - manufacturing conflicts out of a collection that can actually
 * satisfy everyone.
 *
 * Ties break on `collectionItemId` so a deck's allocation is stable across
 * re-syncs; otherwise the same deck would churn its rows on every edit.
 *
 * Returns nothing when the user owns no copies at all. That is an *ownership*
 * gap (KAD-32's badge), not a conflict, and inventing an allocation against a
 * stack that does not exist would report it as one.
 */
export function planAllocation(
  needed: number,
  stacks: readonly AllocatableStack[],
): PlannedAllocation[] {
  if (needed <= 0 || stacks.length === 0) return [];

  const ordered = [...stacks].sort((a, b) => {
    const diff = freeCapacity(b) - freeCapacity(a);
    if (diff !== 0) return diff;
    return a.collectionItemId.localeCompare(b.collectionItemId);
  });

  const plan: PlannedAllocation[] = [];
  let remaining = needed;

  // First pass: satisfy from uncontested capacity.
  for (const stack of ordered) {
    if (remaining === 0) break;
    const take = Math.min(remaining, freeCapacity(stack));
    if (take === 0) continue;
    plan.push({ collectionItemId: stack.collectionItemId, quantity: take });
    remaining -= take;
  }

  // Second pass: the deck still wants copies that are already spoken for.
  // Advisory semantics say record it anyway - the whole point is that the
  // conflict becomes visible rather than the edit becoming impossible. The
  // largest stack absorbs the overflow, since that is where a real person
  // would go looking.
  if (remaining > 0) {
    const target = [...stacks].sort((a, b) => {
      const diff = b.quantity - a.quantity;
      if (diff !== 0) return diff;
      return a.collectionItemId.localeCompare(b.collectionItemId);
    })[0];
    if (target) {
      const existing = plan.find((item) => item.collectionItemId === target.collectionItemId);
      if (existing) existing.quantity += remaining;
      else plan.push({ collectionItemId: target.collectionItemId, quantity: remaining });
    }
  }

  return plan;
}

export interface DeckClaim {
  deckId: string;
  deckName: string;
  quantity: number;
}

export interface ContendedStack {
  collectionItemId: string;
  /** Physical copies that exist. */
  stackQuantity: number;
  /** Copies claimed across every deck, including the one being viewed. */
  totalClaimed: number;
  /** How many copies short the collection is. Always > 0 on a conflict. */
  shortBy: number;
  /** Other decks with a claim, most-claiming first. Never includes the
   *  deck being viewed. */
  competingDecks: DeckClaim[];
}

/**
 * Which of this deck's stacks are over-subscribed.
 *
 * A stack is only a conflict when the claims across *all* decks exceed the
 * copies that physically exist. Two decks each claiming one of a pair of Sol
 * Rings is not a conflict, and reporting it as one would make the warning
 * worthless - which matters more than usual here, because ADR-004 leaves the
 * UI as the only thing standing between the user and a deck they cannot
 * actually build.
 */
export function detectConflicts(
  viewingDeckId: string,
  stacks: { collectionItemId: string; stackQuantity: number; claims: DeckClaim[] }[],
): ContendedStack[] {
  const conflicts: ContendedStack[] = [];

  for (const stack of stacks) {
    const totalClaimed = stack.claims.reduce((sum, claim) => sum + claim.quantity, 0);
    if (totalClaimed <= stack.stackQuantity) continue;

    const competingDecks = stack.claims
      .filter((claim) => claim.deckId !== viewingDeckId)
      .sort((a, b) => {
        const diff = b.quantity - a.quantity;
        if (diff !== 0) return diff;
        return a.deckName.localeCompare(b.deckName);
      });

    // A stack over-committed entirely by the deck being viewed (it asks for
    // 4 copies of a card it owns 1 of) is an ownership shortfall, already
    // reported by KAD-32's badge. Without another deck involved there is no
    // *conflict* to name, and duplicating the badge here would be noise.
    if (competingDecks.length === 0) continue;

    conflicts.push({
      collectionItemId: stack.collectionItemId,
      stackQuantity: stack.stackQuantity,
      totalClaimed,
      shortBy: totalClaimed - stack.stackQuantity,
      competingDecks,
    });
  }

  return conflicts;
}

/** Distinct competing decks across every contended stack on one entry,
 *  most-claiming first - what the UI actually names. */
export function competingDeckNames(conflicts: ContendedStack[]): string[] {
  const byDeck = new Map<string, { name: string; quantity: number }>();
  for (const conflict of conflicts) {
    for (const claim of conflict.competingDecks) {
      const existing = byDeck.get(claim.deckId);
      if (existing) existing.quantity += claim.quantity;
      else byDeck.set(claim.deckId, { name: claim.deckName, quantity: claim.quantity });
    }
  }
  return [...byDeck.values()]
    .sort((a, b) => {
      const diff = b.quantity - a.quantity;
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name);
    })
    .map((deck) => deck.name);
}
