import { describe, expect, it } from "vitest";
import {
  checkBanlist,
  checkColorIdentity,
  checkDeckSize,
  checkSingleton,
  type DeckEntryForValidation,
  type DeckForValidation,
  hasAnyNumberClause,
  isBasicLand,
  type LegalityCard,
  validateDeck,
} from "./legality";

let counter = 0;

function card(overrides: Partial<LegalityCard> = {}): LegalityCard {
  counter += 1;
  return {
    id: `card-${String(counter)}`,
    name: `Card ${String(counter)}`,
    colorIdentity: [],
    keywords: [],
    oracleText: null,
    typeLine: "Artifact",
    legalities: { commander: "legal" },
    ...overrides,
  };
}

function entry(
  card: LegalityCard,
  quantity = 1,
  board: DeckEntryForValidation["board"] = "main",
): DeckEntryForValidation {
  return { card, quantity, board };
}

/** A deck padded with distinct legal cards to exactly 100 including the
 * commander, so a rule test only varies the thing it is testing. */
function legalDeck(overrides: Partial<DeckForValidation> = {}): DeckForValidation {
  const commander = card({
    name: "Yeva, Nature's Herald",
    colorIdentity: ["G"],
    typeLine: "Legendary Creature — Elf Shaman",
  });
  const filler = Array.from({ length: 99 }, (_, index) =>
    entry(card({ name: `Filler ${String(index)}`, colorIdentity: ["G"] })),
  );
  return { format: "commander", commander, partner: null, entries: filler, ...overrides };
}

describe("isBasicLand", () => {
  it("matches a basic land", () => {
    expect(isBasicLand(card({ typeLine: "Basic Land — Forest" }))).toBe(true);
  });

  it("matches a basic snow land", () => {
    expect(isBasicLand(card({ typeLine: "Basic Snow Land — Forest" }))).toBe(true);
  });

  it("rejects a nonbasic land", () => {
    expect(isBasicLand(card({ typeLine: "Land — Forest Island" }))).toBe(false);
  });

  it("does not match a card whose subtype merely mentions basic", () => {
    // Everything before the em dash is the type line proper; a subtype or
    // name after it must not count.
    expect(isBasicLand(card({ typeLine: "Enchantment — Aura", oracleText: "basic land" }))).toBe(
      false,
    );
  });
});

describe("hasAnyNumberClause", () => {
  it("detects the any-number clause", () => {
    const rats = card({
      name: "Rat Colony",
      oracleText: "A deck can have any number of cards named Rat Colony.",
    });
    expect(hasAnyNumberClause(rats)).toBe(true);
  });

  it("is false for a card with no oracle text", () => {
    expect(hasAnyNumberClause(card({ oracleText: null }))).toBe(false);
  });
});

describe("checkDeckSize", () => {
  it("accepts exactly 100 including the commander", () => {
    expect(checkDeckSize(legalDeck())).toEqual([]);
  });

  it("reports how far under the deck is, not just that it's wrong", () => {
    const deck = legalDeck();
    const short: DeckForValidation = { ...deck, entries: deck.entries.slice(0, 90) };
    const [violation] = checkDeckSize(short);
    expect(violation?.rule).toBe("deck_size");
    expect(violation?.detail).toContain("91");
    expect(violation?.detail).toContain("9 under");
  });

  it("reports being over", () => {
    const deck = legalDeck();
    const long: DeckForValidation = { ...deck, entries: [...deck.entries, entry(card())] };
    expect(checkDeckSize(long)[0]?.detail).toContain("1 over");
  });

  it("counts a partner toward the 100", () => {
    const deck = legalDeck();
    const withPartner: DeckForValidation = {
      ...deck,
      partner: card({ name: "A Partner", keywords: ["Partner"] }),
      entries: deck.entries.slice(0, 98),
    };
    expect(checkDeckSize(withPartner)).toEqual([]);
  });

  it("ignores side and maybe boards", () => {
    const deck = legalDeck();
    const withScratch: DeckForValidation = {
      ...deck,
      entries: [...deck.entries, entry(card(), 20, "maybe"), entry(card(), 15, "side")],
    };
    expect(checkDeckSize(withScratch)).toEqual([]);
  });
});

describe("checkSingleton", () => {
  it("accepts one of each", () => {
    expect(checkSingleton(legalDeck())).toEqual([]);
  });

  it("names the card and the count when a duplicate is present", () => {
    const solRing = card({ name: "Sol Ring" });
    const deck = legalDeck({ entries: [entry(solRing, 2)] });
    const [violation] = checkSingleton(deck);

    expect(violation?.rule).toBe("singleton");
    expect(violation?.cardName).toBe("Sol Ring");
    expect(violation?.scryfallId).toBe(solRing.id);
    expect(violation?.detail).toContain("2 copies of Sol Ring");
  });

  it("counts two different printings of the same name as duplicates", () => {
    // Singleton is by name, not printing id - the whole reason this counts
    // on `name` rather than `id`.
    const a = card({ name: "Sol Ring" });
    const b = card({ name: "Sol Ring" });
    const deck = legalDeck({ entries: [entry(a), entry(b)] });
    expect(checkSingleton(deck)).toHaveLength(1);
  });

  it("exempts basic lands", () => {
    const forest = card({ name: "Forest", typeLine: "Basic Land — Forest" });
    expect(checkSingleton(legalDeck({ entries: [entry(forest, 38)] }))).toEqual([]);
  });

  it("exempts cards with an any-number clause", () => {
    const rats = card({
      name: "Rat Colony",
      oracleText: "A deck can have any number of cards named Rat Colony.",
    });
    expect(checkSingleton(legalDeck({ entries: [entry(rats, 30)] }))).toEqual([]);
  });

  it("catches a commander that also appears in the 99", () => {
    const yeva = card({ name: "Yeva, Nature's Herald", colorIdentity: ["G"] });
    const deck = legalDeck({ commander: yeva, entries: [entry(yeva)] });
    expect(checkSingleton(deck)[0]?.cardName).toBe("Yeva, Nature's Herald");
  });

  it("ignores duplicates parked on the maybe board", () => {
    const deck = legalDeck({ entries: [entry(card({ name: "Sol Ring" }), 4, "maybe")] });
    expect(checkSingleton(deck)).toEqual([]);
  });
});

describe("checkColorIdentity", () => {
  it("accepts cards inside the commander's identity", () => {
    expect(checkColorIdentity(legalDeck())).toEqual([]);
  });

  it("accepts colorless cards", () => {
    const deck = legalDeck({ entries: [entry(card({ name: "Sol Ring", colorIdentity: [] }))] });
    expect(checkColorIdentity(deck)).toEqual([]);
  });

  it("names the card and the offending colors", () => {
    const counterspell = card({ name: "Counterspell", colorIdentity: ["U"] });
    const deck = legalDeck({ entries: [entry(counterspell)] });
    const [violation] = checkColorIdentity(deck);

    expect(violation?.rule).toBe("color_identity");
    expect(violation?.cardName).toBe("Counterspell");
    expect(violation?.detail).toContain("U");
    expect(violation?.detail).toContain("outside the commander's G identity");
  });

  it("widens the allowed identity for partners", () => {
    const tana = card({ name: "Tana", colorIdentity: ["R", "G"], keywords: ["Partner"] });
    const sidar = card({ name: "Sidar", colorIdentity: ["G", "W"], keywords: ["Partner"] });
    const white = card({ name: "Swords to Plowshares", colorIdentity: ["W"] });

    const deck = legalDeck({ commander: tana, partner: sidar, entries: [entry(white)] });
    expect(checkColorIdentity(deck)).toEqual([]);
  });

  it("says 'colorless' rather than an empty string when there is no commander", () => {
    const deck = legalDeck({
      commander: null,
      entries: [entry(card({ name: "Llanowar Elves", colorIdentity: ["G"] }))],
    });
    expect(checkColorIdentity(deck)[0]?.detail).toContain("colorless");
  });
});

describe("checkBanlist", () => {
  it("accepts a legal card", () => {
    expect(checkBanlist(legalDeck())).toEqual([]);
  });

  it("names a banned card", () => {
    const banned = card({ name: "Black Lotus", legalities: { commander: "banned" } });
    const [violation] = checkBanlist(legalDeck({ entries: [entry(banned)] }));

    expect(violation?.rule).toBe("banlist");
    expect(violation?.cardName).toBe("Black Lotus");
    expect(violation?.detail).toBe("Black Lotus is banned in Commander.");
  });

  it("flags a not_legal card and says what the status was", () => {
    const acorn = card({ name: "Sly Spy", legalities: { commander: "not_legal" } });
    expect(checkBanlist(legalDeck({ entries: [entry(acorn)] }))[0]?.detail).toContain("not_legal");
  });

  it("treats a card missing from the legalities map as not legal", () => {
    // Silence must not admit a card - an absent key is a data gap, not
    // permission.
    const unknown = card({ name: "Mystery Card", legalities: {} });
    expect(checkBanlist(legalDeck({ entries: [entry(unknown)] }))).toHaveLength(1);
  });

  it("says a banned commander cannot be used as a commander", () => {
    const banned = card({
      name: "Golos, Tireless Pilgrim",
      legalities: { commander: "banned" },
    });
    const [violation] = checkBanlist(legalDeck({ commander: banned }));
    expect(violation?.detail).toContain("cannot be used as a commander");
  });

  it("ignores a banned card sitting on the maybe board", () => {
    const banned = card({ name: "Black Lotus", legalities: { commander: "banned" } });
    expect(checkBanlist(legalDeck({ entries: [entry(banned, 1, "maybe")] }))).toEqual([]);
  });
});

describe("validateDeck", () => {
  it("reports a fully legal deck as legal and validated", () => {
    const result = validateDeck(legalDeck());
    expect(result).toMatchObject({ legal: true, validated: true, format: "commander" });
    expect(result.violations).toEqual([]);
    expect(result.colorIdentity).toEqual(["G"]);
  });

  it("flags a deck with no commander", () => {
    const result = validateDeck(legalDeck({ commander: null }));
    expect(result.violations.some((v) => v.rule === "commander_missing")).toBe(true);
  });

  it("reports every violation at once rather than stopping at the first", () => {
    // A pre-game check is far more useful listing everything wrong than
    // making the user fix one card and re-run.
    const banned = card({
      name: "Black Lotus",
      legalities: { commander: "banned" },
      colorIdentity: ["U"],
    });
    const result = validateDeck(legalDeck({ entries: [entry(banned, 2)] }));

    const rules = new Set(result.violations.map((violation) => violation.rule));
    expect(rules).toContain("deck_size");
    expect(rules).toContain("singleton");
    expect(rules).toContain("color_identity");
    expect(rules).toContain("banlist");
    expect(result.legal).toBe(false);
  });

  it("reports a non-Commander format as unvalidated rather than legal", () => {
    const result = validateDeck({ ...legalDeck(), format: "modern" });
    expect(result.validated).toBe(false);
    expect(result.violations).toEqual([]);
  });

  it("still derives color identity for an unvalidated format", () => {
    const result = validateDeck({ ...legalDeck(), format: "modern" });
    expect(result.colorIdentity).toEqual(["G"]);
  });
});
