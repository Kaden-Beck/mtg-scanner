import type { DeckFormat } from "@mtg/schemas";
import { type Color, deriveColorIdentity, type IdentityCard, offendingColors } from "./color-identity";

/**
 * Commander legality rules engine (KAD-30).
 *
 * Pure functions - nothing here touches the database. The caller hydrates a
 * deck (see `validateDeckById` in `validate.ts`) and passes it in whole,
 * which is what makes the dense unit tests the AC asks for cheap to write:
 * a rule test constructs three cards, not a database.
 *
 * **AC3 (banlist changes reflected without manual re-entry) is a property of
 * *where the data comes from*, not of any code here.** `legalities` is read
 * off the joined `cards` row at validate time, and the bulk ingest (KAD-8)
 * rewrites that column on every sync. The way to break AC3 is to
 * denormalize legality onto `deck_cards` as a performance nicety - don't.
 * A deck is at most ~100 rows; there is no perf problem to solve.
 */

/** The card columns the rules actually read. Deliberately narrower than
 * `CardRow`, so a rule test doesn't have to build a 37-column fixture. */
export interface LegalityCard extends IdentityCard {
  id: string;
  name: string;
  legalities: Record<string, string>;
}

export interface DeckEntryForValidation {
  card: LegalityCard;
  quantity: number;
  /** Only `main` counts toward the deck; side/maybe are brewing scratch space. */
  board: "main" | "side" | "maybe";
}

export interface DeckForValidation {
  format: DeckFormat;
  commander: LegalityCard | null;
  partner: LegalityCard | null;
  entries: DeckEntryForValidation[];
}

export const LEGALITY_RULES = [
  "commander_missing",
  "deck_size",
  "singleton",
  "color_identity",
  "banlist",
] as const;
export type LegalityRule = (typeof LEGALITY_RULES)[number];

/**
 * A violation always names the offending card and the rule broken (KAD-31's
 * AC2). `cardName` is nullable only for `deck_size` and `commander_missing`,
 * which are properties of the deck rather than of any one card - and those
 * carry a `detail` that says exactly what is wrong instead.
 */
export interface LegalityViolation {
  rule: LegalityRule;
  cardName: string | null;
  scryfallId: string | null;
  detail: string;
}

export interface LegalityResult {
  /** False when `violations` is non-empty. Never the only thing reported. */
  legal: boolean;
  /** Whether this format has rules implemented at all. Only Commander does
   * in v1 - an unvalidated format reports `legal: true` with this false,
   * so the UI can say "not validated" rather than "legal". */
  validated: boolean;
  format: DeckFormat;
  colorIdentity: Color[];
  violations: LegalityViolation[];
}

const COMMANDER_DECK_SIZE = 100;

/** Cards a Commander deck may hold any number of. */
const ANY_NUMBER_CLAUSE = "a deck can have any number of cards named";

export function isBasicLand(card: LegalityCard): boolean {
  // Matches "Basic Land - Forest" and "Basic Snow Land - Forest"; excludes
  // "Land" alone and the handful of nonbasic cards whose *text* mentions
  // basic lands, which a naive `includes("Basic")` would not.
  const [typesBeforeDash = ""] = card.typeLine.split("—");
  const types = typesBeforeDash.toLowerCase();
  return types.includes("basic") && types.includes("land");
}

export function hasAnyNumberClause(card: LegalityCard): boolean {
  // Text match rather than a hand-maintained card list, same principle the
  // ticket applies to the banlist. Covers Relentless Rats, Rat Colony,
  // Persistent Petitioners, Dragon's Approach, Shadowborn Apostle, ...
  return (card.oracleText ?? "").toLowerCase().includes(ANY_NUMBER_CLAUSE);
}

export function isSingletonExempt(card: LegalityCard): boolean {
  return isBasicLand(card) || hasAnyNumberClause(card);
}

function mainboard(deck: DeckForValidation): DeckEntryForValidation[] {
  return deck.entries.filter((entry) => entry.board === "main");
}

function commanders(deck: DeckForValidation): LegalityCard[] {
  return [deck.commander, deck.partner].filter((card): card is LegalityCard => card !== null);
}

export function checkCommanderPresent(deck: DeckForValidation): LegalityViolation[] {
  if (deck.commander) return [];
  return [
    {
      rule: "commander_missing",
      cardName: null,
      scryfallId: null,
      detail: "This deck has no commander set.",
    },
  ];
}

/** Exactly 100 cards including the commander(s). Side and maybe boards do
 * not count - they are brewing scratch space, not part of the deck. */
export function checkDeckSize(deck: DeckForValidation): LegalityViolation[] {
  const inDeck = mainboard(deck).reduce((total, entry) => total + entry.quantity, 0);
  const total = inDeck + commanders(deck).length;
  if (total === COMMANDER_DECK_SIZE) return [];

  const difference = Math.abs(total - COMMANDER_DECK_SIZE);
  const direction = total > COMMANDER_DECK_SIZE ? "over" : "under";
  return [
    {
      rule: "deck_size",
      cardName: null,
      scryfallId: null,
      detail: `A Commander deck must be exactly ${String(COMMANDER_DECK_SIZE)} cards including the commander; this deck has ${String(total)} (${String(difference)} ${direction}).`,
    },
  ];
}

/**
 * Singleton is by card *name*, not printing id - two different printings of
 * Sol Ring are still two Sol Rings. Commanders count toward their own name's
 * total, so a commander that also appears in the 99 is caught.
 */
export function checkSingleton(deck: DeckForValidation): LegalityViolation[] {
  const counts = new Map<string, { card: LegalityCard; quantity: number }>();

  const record = (card: LegalityCard, quantity: number) => {
    const existing = counts.get(card.name);
    if (existing) existing.quantity += quantity;
    else counts.set(card.name, { card, quantity });
  };

  for (const entry of mainboard(deck)) record(entry.card, entry.quantity);
  for (const card of commanders(deck)) record(card, 1);

  const violations: LegalityViolation[] = [];
  for (const { card, quantity } of counts.values()) {
    if (quantity <= 1 || isSingletonExempt(card)) continue;
    violations.push({
      rule: "singleton",
      cardName: card.name,
      scryfallId: card.id,
      detail: `Commander is a singleton format, but this deck has ${String(quantity)} copies of ${card.name}.`,
    });
  }
  return violations;
}

/**
 * Every card's color identity must fit inside the commander's. Reported per
 * offending card, naming the specific colors that don't fit - "deck is
 * illegal" is exactly what KAD-31 rules out.
 */
export function checkColorIdentity(deck: DeckForValidation): LegalityViolation[] {
  const identity = deriveColorIdentity(deck.commander, deck.partner);
  const violations: LegalityViolation[] = [];

  for (const entry of mainboard(deck)) {
    const offending = offendingColors(entry.card, identity);
    if (offending.length === 0) continue;
    violations.push({
      rule: "color_identity",
      cardName: entry.card.name,
      scryfallId: entry.card.id,
      detail: `${entry.card.name} has ${offending.join("")} in its color identity, which is outside the commander's ${identity.length > 0 ? identity.join("") : "colorless"} identity.`,
    });
  }
  return violations;
}

/**
 * Banlist straight off `legalities.commander`, which the bulk sync refreshes
 * - no hand-maintained list, per the ticket. A card missing from the map is
 * treated as not legal rather than legal: silence should not admit a card.
 */
export function checkBanlist(deck: DeckForValidation): LegalityViolation[] {
  const violations: LegalityViolation[] = [];

  const check = (card: LegalityCard, role: "commander" | "card") => {
    const status = card.legalities["commander"] ?? "not_legal";
    if (status === "legal" || status === "restricted") return;
    const reason =
      status === "banned"
        ? `${card.name} is banned in Commander.`
        : `${card.name} is not legal in Commander (status: ${status}).`;
    violations.push({
      rule: "banlist",
      cardName: card.name,
      scryfallId: card.id,
      detail: role === "commander" ? `${reason} It cannot be used as a commander.` : reason,
    });
  };

  for (const card of commanders(deck)) check(card, "commander");
  for (const entry of mainboard(deck)) check(entry.card, "card");
  return violations;
}

/**
 * Runs every rule and returns all violations, not just the first - a
 * pre-game check is far more useful when it lists everything wrong at once
 * than when it makes the user fix one card and re-run.
 */
export function validateDeck(deck: DeckForValidation): LegalityResult {
  const colorIdentity = deriveColorIdentity(deck.commander, deck.partner);

  if (deck.format !== "commander") {
    // Format is carried on `decks` from KAD-26 precisely so this dispatch
    // exists. Other formats report as unvalidated rather than silently
    // "legal", which would be a lie the UI would repeat.
    return { legal: true, validated: false, format: deck.format, colorIdentity, violations: [] };
  }

  const violations = [
    ...checkCommanderPresent(deck),
    ...checkDeckSize(deck),
    ...checkSingleton(deck),
    ...checkColorIdentity(deck),
    ...checkBanlist(deck),
  ];

  return {
    legal: violations.length === 0,
    validated: true,
    format: deck.format,
    colorIdentity,
    violations,
  };
}
