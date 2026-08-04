import type { Condition, Finish } from "@mtg/schemas";
import type { CardRow } from "../db/schema";

/**
 * Ownership overlay rules (KAD-32), pure so they stay cheap to test - the
 * DB half lives in `hydrate.ts`, same split as `color-identity.ts`.
 *
 * This module deliberately knows nothing about allocation. "Owned" and
 * "available" are different questions under ADR-004 (allocation is advisory,
 * so a copy can be owned and simultaneously claimed by three other decks),
 * and conflating them here would make the badge lie. KAD-33 layers conflict
 * on top of this.
 */

export type OwnershipStatus = "owned" | "partial" | "unowned";

/**
 * A physical stack backing a deck entry, carrying enough to answer KAD-21
 * AC2 ("where is the copy stored") - that AC was descoped from KAD-21
 * because no decks existed yet, and lands here.
 */
export interface OwnedStack {
  collectionItemId: string;
  scryfallId: string;
  quantity: number;
  finish: Finish;
  condition: Condition;
  binderLocation: string;
  isProxy: boolean;
  /**
   * False when this stack is a *different printing* of the same oracle card.
   * Kept as a flag rather than filtered out because in paper any printing is
   * playable - a deck asking for the Kaladesh Sol Ring is satisfied by the
   * Commander 2019 one - but the user still wants to know they'll be pulling
   * a different art than the list says.
   */
  exactPrinting: boolean;
}

export interface EntryOwnership {
  needed: number;
  /** Copies of the exact printing the deck names. */
  ownedExact: number;
  /** Copies of a different printing of the same oracle card. */
  ownedOtherPrinting: number;
  /** How many of the owned copies are proxies. Subset of the two above. */
  ownedProxy: number;
  owned: number;
  /** Copies the user would have to acquire. Zero once `owned >= needed`. */
  missing: number;
  status: OwnershipStatus;
  /** Exact printings first, then by binder location, so the nearest match
   *  to what the list actually says is the one the user reads first. */
  stacks: OwnedStack[];
}

/**
 * Proxies count as owned. The alternative tells a user to go buy a card they
 * already have a physical stand-in for, which is wrong for the "assemble a
 * deck tonight" workflow this overlay exists to serve. `ownedProxy` is
 * carried separately so the UI can still say so.
 */
export function resolveEntryOwnership(needed: number, stacks: OwnedStack[]): EntryOwnership {
  let ownedExact = 0;
  let ownedOtherPrinting = 0;
  let ownedProxy = 0;

  for (const stack of stacks) {
    if (stack.exactPrinting) ownedExact += stack.quantity;
    else ownedOtherPrinting += stack.quantity;
    if (stack.isProxy) ownedProxy += stack.quantity;
  }

  const owned = ownedExact + ownedOtherPrinting;
  const missing = Math.max(0, needed - owned);

  return {
    needed,
    ownedExact,
    ownedOtherPrinting,
    ownedProxy,
    owned,
    missing,
    status: owned === 0 ? "unowned" : missing > 0 ? "partial" : "owned",
    stacks: sortStacks(stacks),
  };
}

function sortStacks(stacks: OwnedStack[]): OwnedStack[] {
  return [...stacks].sort((a, b) => {
    if (a.exactPrinting !== b.exactPrinting) return a.exactPrinting ? -1 : 1;
    return a.binderLocation.localeCompare(b.binderLocation);
  });
}

export const OWNERSHIP_LABELS: Record<OwnershipStatus, string> = {
  owned: "Owned",
  partial: "Partially owned",
  unowned: "Not owned",
};

/**
 * "Binder 2, Deck box" - distinct locations, deduped, in stack order.
 * Empty when nothing is owned, or when every stack has a blank location
 * (which is the default for an imported collection nobody has filed yet).
 */
export function locationSummary(ownership: EntryOwnership): string {
  const seen = new Set<string>();
  for (const stack of ownership.stacks) {
    if (stack.binderLocation !== "") seen.add(stack.binderLocation);
  }
  return [...seen].join(", ");
}

/**
 * Cheapest plausible acquisition price in USD, or null when Scryfall has no
 * price at all for this printing.
 *
 * Falls through nonfoil -> foil -> etched rather than reading only `usd`,
 * because a foil-only printing (most Secret Lairs, promos, From the Vault)
 * has `usd: null` and would otherwise silently drop out of the cost
 * estimate as if it were free.
 */
export function unitPriceUsd(card: CardRow): number | null {
  for (const key of ["usd", "usd_foil", "usd_etched"] as const) {
    const raw = card.prices[key];
    if (raw == null) continue;
    const value = Number.parseFloat(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export interface UnownedSummary {
  /** Distinct cards with at least one copy missing. */
  cardCount: number;
  /** Total copies missing across those cards. */
  copyCount: number;
  estimatedCostUsd: number;
  /**
   * Missing cards Scryfall has no price for. Reported alongside the estimate
   * because without it the total silently understates - an unpriced card
   * would look like a free one.
   */
  unpricedCount: number;
}

export function summarizeUnowned(
  items: { card: CardRow; ownership: EntryOwnership }[],
): UnownedSummary {
  let cardCount = 0;
  let copyCount = 0;
  let estimatedCostUsd = 0;
  let unpricedCount = 0;

  for (const { card, ownership } of items) {
    if (ownership.missing === 0) continue;
    cardCount += 1;
    copyCount += ownership.missing;

    const price = unitPriceUsd(card);
    if (price === null) unpricedCount += 1;
    else estimatedCostUsd += price * ownership.missing;
  }

  // Money, so bank the accumulated float once at the end rather than
  // per-card - rounding each line item first drifts on a 100-card list.
  return {
    cardCount,
    copyCount,
    estimatedCostUsd: Math.round(estimatedCostUsd * 100) / 100,
    unpricedCount,
  };
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** "12 cards · 14 copies · ~$83.40 (3 unpriced)" - the AC3 line. */
export function formatUnownedSummary(summary: UnownedSummary): string {
  if (summary.cardCount === 0) return "Every card in this deck is owned";

  const parts = [
    `${String(summary.cardCount)} ${summary.cardCount === 1 ? "card" : "cards"} missing`,
  ];
  // Only worth saying when it differs from the card count, otherwise it is
  // the same number twice.
  if (summary.copyCount !== summary.cardCount) {
    parts.push(`${String(summary.copyCount)} copies`);
  }
  parts.push(`~${formatUsd(summary.estimatedCostUsd)}`);
  if (summary.unpricedCount > 0) {
    parts.push(`${String(summary.unpricedCount)} unpriced`);
  }
  return parts.join(" · ");
}
