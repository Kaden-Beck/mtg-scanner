import { assertNever } from "@mtg/schemas";
import type { LegalityResult, LegalityRule, LegalityViolation } from "@/server/decks/legality";

/**
 * Presentation for the legality report (KAD-31).
 *
 * Pure and separate from the page component for the ADR-007 reason: Vitest
 * cannot render an async Server Component at all, so anything with a
 * meaningful branch lives here in a `.test.ts`-testable module instead of
 * being stranded inside the RSC.
 *
 * The whole point of the ticket is that "Deck is illegal" is not an
 * acceptable message. Every function here is in service of naming the
 * specific card and the specific rule.
 */

export function ruleLabel(rule: LegalityRule): string {
  switch (rule) {
    case "commander_missing":
      return "No commander";
    case "deck_size":
      return "Deck size";
    case "singleton":
      return "Singleton rule";
    case "color_identity":
      return "Color identity";
    case "banlist":
      return "Banned or not legal";
    default:
      return assertNever(rule);
  }
}

/**
 * How to fix it. Deliberately distinct from `ruleLabel` (what is wrong) and
 * from the violation's own `detail` (which card, specifically) - a report
 * that says all three is the difference between "deck is illegal" and
 * something the user can act on without knowing the rules by heart.
 */
export function ruleRemedy(rule: LegalityRule): string {
  switch (rule) {
    case "commander_missing":
      return "Set a legendary creature as this deck's commander.";
    case "deck_size":
      return "Add or remove cards until the deck is exactly 100 including the commander.";
    case "singleton":
      return "Remove the extra copies, or replace them with different cards.";
    case "color_identity":
      return "Replace the card, or change commander to one whose identity includes these colors.";
    case "banlist":
      return "Remove the card - it cannot be played in Commander.";
    default:
      return assertNever(rule);
  }
}

export interface ViolationGroup {
  rule: LegalityRule;
  label: string;
  remedy: string;
  violations: LegalityViolation[];
}

/**
 * Groups violations by rule, in `LEGALITY_RULES` order rather than the order
 * they were produced - a deck missing its commander should lead with that,
 * not with the 60 color-identity errors that are its downstream consequence.
 */
export function groupViolations(violations: LegalityViolation[]): ViolationGroup[] {
  const order: LegalityRule[] = [
    "commander_missing",
    "banlist",
    "color_identity",
    "singleton",
    "deck_size",
  ];

  return order
    .map((rule) => ({
      rule,
      label: ruleLabel(rule),
      remedy: ruleRemedy(rule),
      violations: violations.filter((violation) => violation.rule === rule),
    }))
    .filter((group) => group.violations.length > 0);
}

/**
 * One-line verdict. Never just "illegal": it says how many problems and
 * across how many rules, so the headline itself carries information.
 */
export function verdictSummary(result: LegalityResult): string {
  if (!result.validated) {
    return `Legality is not checked for ${result.format} decks yet.`;
  }
  if (result.legal) return "This deck is legal for Commander.";

  const count = result.violations.length;
  const rules = new Set(result.violations.map((violation) => violation.rule)).size;
  const problems = count === 1 ? "1 problem" : `${String(count)} problems`;
  const across = rules === 1 ? "1 rule" : `${String(rules)} rules`;
  return `This deck is not legal for Commander: ${problems} across ${across}.`;
}

export type VerdictTone = "legal" | "illegal" | "unvalidated";

export function verdictTone(result: LegalityResult): VerdictTone {
  if (!result.validated) return "unvalidated";
  return result.legal ? "legal" : "illegal";
}

/** Text for one violation row. Always names the card when there is one -
 * the literal AC2 requirement. */
export function violationLine(violation: LegalityViolation): string {
  return violation.cardName ? `${violation.cardName}: ${violation.detail}` : violation.detail;
}
