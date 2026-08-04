import { assertNever } from "@mtg/schemas";
import {
  type EntryOwnership,
  locationSummary,
  type OwnershipStatus,
} from "@/server/decks/ownership";

/**
 * Presentation for the ownership overlay (KAD-32).
 *
 * Pure and separate from the page for the ADR-007 reason - Vitest cannot
 * render an async Server Component, so the branching lives here where a
 * `.test.ts` reaches it. Same split as `legality-format.ts`.
 */

export function ownershipLabel(status: OwnershipStatus): string {
  switch (status) {
    case "owned":
      return "Owned";
    case "partial":
      return "Partial";
    case "unowned":
      return "Not owned";
    default:
      return assertNever(status);
  }
}

export type OwnershipTone = "owned" | "partial" | "unowned";

export function ownershipTone(ownership: EntryOwnership): OwnershipTone {
  return ownership.status;
}

/**
 * The accessible name on the badge. Spells out the counts rather than
 * relying on colour, which is the only thing distinguishing owned from
 * unowned at a glance.
 */
export function ownershipBadgeLabel(cardName: string, ownership: EntryOwnership): string {
  switch (ownership.status) {
    case "owned":
      return `${cardName}: owned, ${String(ownership.owned)} of ${String(ownership.needed)} needed`;
    case "partial":
      return `${cardName}: partially owned, ${String(ownership.owned)} of ${String(ownership.needed)} needed`;
    case "unowned":
      return `${cardName}: not owned`;
    default:
      return assertNever(ownership.status);
  }
}

/** Short text inside the badge - "2/4", or just the word when it adds nothing. */
export function ownershipBadgeText(ownership: EntryOwnership): string {
  if (ownership.status === "unowned") return "Not owned";
  if (ownership.status === "partial") {
    return `${String(ownership.owned)}/${String(ownership.needed)}`;
  }
  return "Owned";
}

/**
 * The detail line under a card: where the copies are, and any caveat about
 * *which* copies they are. Empty string when there is nothing to say, so the
 * caller can skip rendering the element entirely.
 *
 * Ordering is deliberate - location first, because "which binder" is the
 * question the user has physically got up to answer.
 */
export function ownershipDetail(ownership: EntryOwnership): string {
  if (ownership.status === "unowned") return "";

  const parts: string[] = [];

  const locations = locationSummary(ownership);
  if (locations !== "") parts.push(locations);
  else parts.push("No location recorded");

  // Only worth flagging when there is no exact copy at all. If the user owns
  // the printing the list names, that a spare of another art also exists is
  // noise.
  if (ownership.ownedExact === 0 && ownership.ownedOtherPrinting > 0) {
    parts.push("different printing");
  }

  if (ownership.ownedProxy > 0) {
    parts.push(
      ownership.ownedProxy === ownership.owned ? "proxy" : `${String(ownership.ownedProxy)} proxy`,
    );
  }

  return parts.join(" · ");
}
