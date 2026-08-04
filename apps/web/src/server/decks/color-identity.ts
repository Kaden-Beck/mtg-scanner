/**
 * Commander color-identity derivation (KAD-28).
 *
 * Pure functions over card rows - no DB access, and nothing here is ever
 * persisted. Identity is recomputed on every read so that a Scryfall
 * erratum arriving in a later bulk sync takes effect immediately, rather
 * than leaving a stale value baked into `decks`. Same reasoning that keeps
 * legality off `deck_cards` in KAD-30.
 */

/** Canonical WUBRG ordering. Scryfall emits this order; we re-impose it so
 * a union of two identities doesn't come out in insertion order. */
export const WUBRG = ["W", "U", "B", "R", "G"] as const;
export type Color = (typeof WUBRG)[number];

const COLOR_SET = new Set<string>(WUBRG);

/** Type guard rather than a cast: `color_identity` is a JSON column, so a
 * malformed ingest could put anything in it, and this is the one place that
 * narrows an arbitrary string to a real color. */
function isColor(value: string): value is Color {
  return COLOR_SET.has(value);
}

/** The card columns identity derivation actually reads. Narrower than
 * `CardRow` on purpose: it makes the function trivially callable from a
 * test without constructing a 37-column row, and documents the real
 * dependency surface. */
export interface IdentityCard {
  colorIdentity: string[];
  keywords: string[];
  oracleText: string | null;
  typeLine: string;
}

export function sortColors(colors: Iterable<string>): Color[] {
  const seen = new Set<Color>();
  for (const color of colors) {
    // Filtered, not trusted: an unknown symbol would otherwise sort to -1
    // and silently lead the list.
    if (isColor(color)) seen.add(color);
  }
  return [...seen].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
}

/**
 * Keyword-detectable ways two commanders legally share a command zone.
 *
 * Scryfall puts all of these in the `keywords` array, which is why this
 * reads keywords rather than pattern-matching oracle text: the text
 * ("Partner with Tana the Bloodsower", "Friends forever") varies per card,
 * the keyword does not.
 *
 * **Known gap:** Backgrounds ("Choose a Background" + an Enchantment —
 * Background) and Doctor's companion are *not* handled. Both are real
 * partner-like mechanics that combine identity, and both need more than a
 * keyword lookup - Backgrounds require checking the second card's type
 * line, and pairing rules differ. KAD-28 is 2 points and its AC says only
 * "Partner commanders combine identities", so they are out of scope here
 * rather than half-implemented. See the test that documents this.
 */
const PARTNER_KEYWORDS = ["partner", "friends forever"] as const;

export function hasPartnerKeyword(card: IdentityCard): boolean {
  return card.keywords.some((keyword) => {
    const normalized = keyword.trim().toLowerCase();
    // `startsWith` rather than equality: "Partner with" is its own keyword
    // string, and it combines identity exactly like bare "Partner" does.
    return PARTNER_KEYWORDS.some((partner) => normalized.startsWith(partner));
  });
}

/**
 * Union of the commander's and partner's color identities, in WUBRG order.
 *
 * A deck with no commander has an empty identity, which the legality engine
 * (KAD-30) treats as "colorless only" - correct for a Commander deck that
 * hasn't picked one yet, and the reason that shows up as a violation there
 * rather than being silently permissive here.
 *
 * A partner is only folded in when it actually carries a partner keyword.
 * Two arbitrary legendary creatures in the two slots is an illegal pairing,
 * and quietly widening the identity to match would make every card in the
 * deck pass the identity check for a deck that can't be built.
 */
export function deriveColorIdentity(
  commander: IdentityCard | null | undefined,
  partner?: IdentityCard | null,
): Color[] {
  if (!commander) return [];
  if (!partner) return sortColors(commander.colorIdentity);
  if (!hasPartnerKeyword(commander) || !hasPartnerKeyword(partner)) {
    return sortColors(commander.colorIdentity);
  }
  return sortColors([...commander.colorIdentity, ...partner.colorIdentity]);
}

/**
 * Whether `card`'s identity fits inside `identity`. Colorless cards fit any
 * identity, which is why this is a subset test rather than an intersection.
 */
export function isWithinIdentity(card: Pick<IdentityCard, "colorIdentity">, identity: Color[]) {
  const allowed = new Set<string>(identity);
  return card.colorIdentity.every((color) => allowed.has(color));
}

/** Colors in `card` that `identity` does not permit, WUBRG-ordered - the
 * detail KAD-31's report needs to say *why* a card is out of identity. */
export function offendingColors(
  card: Pick<IdentityCard, "colorIdentity">,
  identity: Color[],
): Color[] {
  const allowed = new Set<string>(identity);
  return sortColors(card.colorIdentity.filter((color) => !allowed.has(color)));
}
