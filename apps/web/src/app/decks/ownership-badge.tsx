import type { ContendedStack } from "@/server/decks/allocation";
import type { EntryOwnership, UnownedSummary } from "@/server/decks/ownership";
import { formatUnownedSummary } from "@/server/decks/ownership";
import { conflictLabel, conflictLine, conflictSummary } from "./conflict-format";
import { ownershipBadgeLabel, ownershipBadgeText, ownershipDetail } from "./ownership-format";

const TONE_STYLES = {
  owned: "border-green-800 bg-green-950/40 text-green-300",
  partial: "border-amber-800 bg-amber-950/40 text-amber-300",
  unowned: "border-red-900 bg-red-950/40 text-red-300",
} as const;

/**
 * Per-card ownership marker (KAD-32 AC1).
 *
 * The status is carried by a visually-hidden span rather than an
 * `aria-label`, because a plain `<span>` has no role that supports an
 * accessible name - assistive tech ignores the attribute even though
 * Playwright's `getByLabel` would still find it. Same trap as the `<p>`
 * documented in CLAUDE.md.
 *
 * So the short visual text ("2/4") is hidden from the accessibility tree and
 * the full sentence is exposed instead. That is also the better outcome on
 * its own terms: colour is the only thing separating the three states
 * visually, and "2/4" read aloud means nothing.
 */
export function OwnershipBadge({
  cardName,
  ownership,
}: {
  cardName: string;
  ownership: EntryOwnership;
}) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-xs whitespace-nowrap ${TONE_STYLES[ownership.status]}`}
    >
      <span aria-hidden="true">{ownershipBadgeText(ownership)}</span>
      <span className="sr-only">{ownershipBadgeLabel(cardName, ownership)}</span>
    </span>
  );
}

/**
 * Where the physical copies live - KAD-21 AC2, descoped from Sprint 4
 * because no decks existed to display it on yet.
 */
export function OwnershipDetail({ ownership }: { ownership: EntryOwnership }) {
  const detail = ownershipDetail(ownership);
  if (detail === "") return null;
  return <span className="text-xs text-neutral-500">{detail}</span>;
}

/**
 * Cross-deck allocation conflict (KAD-33 AC2).
 *
 * Always names a competing deck - "there is a conflict" would be the
 * allocation equivalent of "deck is illegal". Same visually-hidden-span
 * treatment as the ownership badge, and for the same reason: the visible
 * text is truncated to two deck names, so the accessible sentence carries the
 * full list plus the shortfall the short line leaves implicit.
 */
export function ConflictBadge({
  cardName,
  conflicts,
}: {
  cardName: string;
  conflicts: ContendedStack[];
}) {
  if (conflicts.length === 0) return null;
  return (
    <span className="rounded border border-orange-800 bg-orange-950/40 px-1.5 py-0.5 text-xs whitespace-nowrap text-orange-300">
      <span aria-hidden="true">{conflictLine(conflicts)}</span>
      <span className="sr-only">{conflictLabel(cardName, conflicts)}</span>
    </span>
  );
}

/**
 * Deck-level conflict count.
 *
 * ADR-004 records the accepted cost that "owned" never means "available right
 * now" - two decks can both report fully owned while sharing one copy. This
 * line is what makes the availability question reachable from the same place
 * ownership is claimed, so it renders next to the ownership summary rather
 * than somewhere the user has to go looking.
 */
export function ConflictSummaryLine({
  conflictsByEntry,
}: {
  conflictsByEntry: Map<string, ContendedStack[]>;
}) {
  const text = conflictSummary(conflictsByEntry);
  if (text === "") return null;
  return (
    <section aria-label="Deck allocation conflicts">
      <p className="rounded border border-orange-800 bg-orange-950/40 px-3 py-2 text-sm text-orange-300">
        {text}
      </p>
    </section>
  );
}

/**
 * Deck-level "what would it cost to finish this" line (KAD-32 AC3).
 *
 * A named `<section>` (a `region` landmark, which does support naming)
 * rather than the legality report's `role="alert"`: this is standing
 * information, not a response to an action, and a second live region on the
 * page would compete with the one that actually needs to announce.
 */
export function UnownedSummaryLine({ summary }: { summary: UnownedSummary }) {
  const complete = summary.cardCount === 0;
  return (
    <section aria-label="Deck ownership summary">
      <p
        className={`rounded border px-3 py-2 text-sm ${
          complete
            ? "border-green-800 bg-green-950/40 text-green-300"
            : "border-neutral-700 bg-neutral-900 text-neutral-300"
        }`}
      >
        {formatUnownedSummary(summary)}
      </p>
    </section>
  );
}
