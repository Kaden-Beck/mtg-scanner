import { describe, expect, it } from "vitest";
import {
  deriveColorIdentity,
  type IdentityCard,
  isWithinIdentity,
  offendingColors,
  sortColors,
} from "./color-identity";

function card(overrides: Partial<IdentityCard> = {}): IdentityCard {
  return {
    colorIdentity: [],
    keywords: [],
    oracleText: null,
    typeLine: "Legendary Creature — Human",
    ...overrides,
  };
}

describe("sortColors", () => {
  it("re-imposes WUBRG order regardless of input order", () => {
    expect(sortColors(["G", "W", "B"])).toEqual(["W", "B", "G"]);
  });

  it("de-duplicates", () => {
    expect(sortColors(["R", "R", "R"])).toEqual(["R"]);
  });

  it("drops symbols that aren't colors rather than sorting them to the front", () => {
    // `color_identity` is a JSON column; a malformed ingest could put
    // anything there, and an unknown symbol ranking -1 would lead the list.
    expect(sortColors(["G", "C", "W"])).toEqual(["W", "G"]);
  });
});

describe("deriveColorIdentity", () => {
  it("is empty when no commander is set", () => {
    expect(deriveColorIdentity(null)).toEqual([]);
  });

  it("returns the commander's own identity when there is no partner", () => {
    expect(deriveColorIdentity(card({ colorIdentity: ["G", "W"] }))).toEqual(["W", "G"]);
  });

  it("combines identities for two Partner commanders", () => {
    // Tana the Bloodsower (RG) + Sidar Kondo of Jamuraa (WG) -> RGW.
    const tana = card({ colorIdentity: ["R", "G"], keywords: ["Partner"] });
    const sidar = card({ colorIdentity: ["G", "W"], keywords: ["Partner"] });
    expect(deriveColorIdentity(tana, sidar)).toEqual(["W", "R", "G"]);
  });

  it("combines identities for 'Partner with' commanders", () => {
    // The keyword string is "Partner with <name>", not bare "Partner".
    const a = card({ colorIdentity: ["U"], keywords: ["Partner with Pir, Imaginative Rascal"] });
    const b = card({ colorIdentity: ["G"], keywords: ["Partner with Toothy, Imaginary Friend"] });
    expect(deriveColorIdentity(a, b)).toEqual(["U", "G"]);
  });

  it("combines identities for Friends forever", () => {
    const a = card({ colorIdentity: ["W"], keywords: ["Friends forever"] });
    const b = card({ colorIdentity: ["B"], keywords: ["Friends forever"] });
    expect(deriveColorIdentity(a, b)).toEqual(["W", "B"]);
  });

  it("is case- and whitespace-insensitive about the keyword", () => {
    const a = card({ colorIdentity: ["W"], keywords: [" partner "] });
    const b = card({ colorIdentity: ["B"], keywords: ["PARTNER"] });
    expect(deriveColorIdentity(a, b)).toEqual(["W", "B"]);
  });

  it("ignores a second card that carries no partner keyword", () => {
    // Two arbitrary legends is an illegal pairing. Widening the identity
    // anyway would make every card in the deck pass the identity check for
    // a deck that cannot legally be built - the violation belongs in
    // KAD-30, so derivation must not paper over it here.
    const commander = card({ colorIdentity: ["R"] });
    const notAPartner = card({ colorIdentity: ["U"] });
    expect(deriveColorIdentity(commander, notAPartner)).toEqual(["R"]);
  });

  it("ignores a partner when the commander itself can't partner", () => {
    const commander = card({ colorIdentity: ["R"] });
    const partner = card({ colorIdentity: ["U"], keywords: ["Partner"] });
    expect(deriveColorIdentity(commander, partner)).toEqual(["R"]);
  });

  it("documents the Background / Doctor's companion gap", () => {
    // KNOWN GAP (KAD-28 scope call): Backgrounds and Doctor's companion are
    // real identity-combining mechanics that this does not handle, because
    // neither is a simple keyword lookup on both cards. If these need to
    // work, that is a follow-up ticket, not a silent bug. This test exists
    // so the gap fails loudly the day someone implements it.
    const commander = card({ colorIdentity: ["W"], keywords: ["Choose a Background"] });
    const background = card({
      colorIdentity: ["B"],
      typeLine: "Enchantment — Background",
    });
    expect(deriveColorIdentity(commander, background)).toEqual(["W"]);
  });
});

describe("isWithinIdentity", () => {
  it("admits colorless cards into any identity", () => {
    expect(isWithinIdentity({ colorIdentity: [] }, ["W"])).toBe(true);
    expect(isWithinIdentity({ colorIdentity: [] }, [])).toBe(true);
  });

  it("admits a strict subset", () => {
    expect(isWithinIdentity({ colorIdentity: ["G"] }, ["W", "R", "G"])).toBe(true);
  });

  it("rejects a card carrying a color the commander doesn't", () => {
    expect(isWithinIdentity({ colorIdentity: ["U"] }, ["W", "R", "G"])).toBe(false);
  });

  it("rejects any colored card in a colorless identity", () => {
    expect(isWithinIdentity({ colorIdentity: ["B"] }, [])).toBe(false);
  });
});

describe("offendingColors", () => {
  it("names only the colors outside the identity, WUBRG-ordered", () => {
    expect(offendingColors({ colorIdentity: ["B", "U", "G"] }, ["G"])).toEqual(["U", "B"]);
  });

  it("is empty for a legal card", () => {
    expect(offendingColors({ colorIdentity: ["G"] }, ["W", "G"])).toEqual([]);
  });
});
