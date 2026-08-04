import type { LegalityResult } from "@/server/decks/legality";
import { groupViolations, verdictSummary, verdictTone, violationLine } from "./legality-format";

const TONE_STYLES = {
  legal: "border-green-700 bg-green-950/40 text-green-200",
  illegal: "border-red-700 bg-red-950/40 text-red-200",
  unvalidated: "border-neutral-700 bg-neutral-900 text-neutral-300",
} as const;

/**
 * The legality report (KAD-31). "Deck is illegal" is explicitly not an
 * acceptable message, so every row names the offending card and the rule it
 * breaks, grouped by rule with a remedy per group.
 *
 * The alert carries an explicit `aria-label`: Next renders its own
 * `role="alert"` route announcer on every page, so an unnamed live region
 * is both ambiguous to Playwright's strict mode and worse for screen
 * readers.
 */
export function LegalityReport({ result }: { result: LegalityResult }) {
  const tone = verdictTone(result);
  const groups = groupViolations(result.violations);

  return (
    <section className="flex flex-col gap-3">
      <p
        aria-label="Deck legality"
        className={`rounded border px-3 py-2 text-sm ${TONE_STYLES[tone]}`}
        role="alert"
      >
        {verdictSummary(result)}
      </p>

      {groups.map((group) => (
        <div className="rounded border border-neutral-800 bg-neutral-950 p-3" key={group.rule}>
          <h3 className="text-sm font-semibold text-neutral-100">
            {group.label}
            <span className="ml-2 font-normal text-neutral-400">
              ({group.violations.length})
            </span>
          </h3>
          <p className="mt-1 text-xs text-neutral-400">{group.remedy}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {group.violations.map((violation) => (
              <li
                className="text-sm text-neutral-200"
                key={`${violation.rule}-${violation.scryfallId ?? "deck"}-${violation.cardName ?? ""}`}
              >
                {violationLine(violation)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
