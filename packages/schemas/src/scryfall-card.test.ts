import { describe, expect, it } from "vitest";
import { isCollectibleCard, scryfallCardSchema } from "./scryfall-card";

// Trimmed down from a real `default_cards` bulk-data row (Forest, BLB #280),
// fetched 2026-08-02 to confirm the actual field shapes before writing this
// schema - Scryfall's bulk-data endpoint now only serves gzipped JSONL, and
// the set code lives under `set`, not `set_code`.
const forestFixture = {
  object: "card",
  id: "0000419b-0bba-4488-8f7a-6194544ce91e",
  oracle_id: "b34bb2dc-c1af-4d77-b0b3-a0fb342a5fc6",
  name: "Forest",
  lang: "en",
  released_at: "2024-08-02",
  layout: "normal",
  mana_cost: "",
  cmc: 0,
  type_line: "Basic Land — Forest",
  oracle_text: "({T}: Add {G}.)",
  colors: [],
  color_identity: ["G"],
  keywords: [],
  legalities: { standard: "legal", oldschool: "not_legal" },
  games: ["paper", "mtgo", "arena"],
  reserved: false,
  finishes: ["nonfoil", "foil"],
  set: "blb",
  set_name: "Bloomburrow",
  set_type: "expansion",
  collector_number: "280",
  rarity: "common",
  artist: "David Robert Hovey",
  border_color: "black",
  frame: "2015",
  full_art: true,
  textless: false,
  promo: false,
  variation: false,
  image_uris: { normal: "https://cards.scryfall.io/normal/front/0/0/x.jpg" },
  scryfall_uri: "https://scryfall.com/card/blb/280/forest",
  prices: { usd: "0.31", usd_foil: "0.55", usd_etched: null, eur: "0.28", tix: "0.03" },
};

describe("scryfallCardSchema", () => {
  it("parses a real default_cards row", () => {
    const card = scryfallCardSchema.parse(forestFixture);
    expect(card.name).toBe("Forest");
    expect(card.set).toBe("blb");
  });

  it("tolerates unknown fields via .loose() (Scryfall adds fields without notice)", () => {
    const card = scryfallCardSchema.parse({ ...forestFixture, some_future_field: 42 });
    expect(card.name).toBe("Forest");
  });

  it("rejects an object missing a required field", () => {
    const { name: _name, ...withoutName } = forestFixture;
    expect(() => scryfallCardSchema.parse(withoutName)).toThrow();
  });
});

describe("isCollectibleCard", () => {
  it("includes an ordinary expansion card", () => {
    const card = scryfallCardSchema.parse(forestFixture);
    expect(isCollectibleCard(card)).toBe(true);
  });

  it("excludes token-layout objects", () => {
    const card = scryfallCardSchema.parse({
      ...forestFixture,
      layout: "token",
      set_type: "token",
    });
    expect(isCollectibleCard(card)).toBe(false);
  });

  it("excludes funny (Un-set) cards", () => {
    const card = scryfallCardSchema.parse({ ...forestFixture, set_type: "funny" });
    expect(isCollectibleCard(card)).toBe(false);
  });

  it("excludes emblems and vanguard/planar/scheme layouts", () => {
    for (const layout of ["emblem", "vanguard", "planar", "scheme", "double_faced_token"]) {
      const card = scryfallCardSchema.parse({ ...forestFixture, layout });
      expect(isCollectibleCard(card)).toBe(false);
    }
  });
});
