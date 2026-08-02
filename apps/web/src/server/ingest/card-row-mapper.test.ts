import { scryfallCardSchema } from "@mtg/schemas";
import { describe, expect, it } from "vitest";
import { toCardRow } from "./card-row-mapper";

const cardFixture = scryfallCardSchema.parse({
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
  legalities: { standard: "legal" },
  games: ["paper"],
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
  image_uris: { normal: "https://cards.scryfall.io/normal/x.jpg" },
  scryfall_uri: "https://scryfall.com/card/blb/280/forest",
  prices: { usd: "0.31" },
});

describe("toCardRow", () => {
  it("maps Scryfall's `set` field to the DB's `setCode` column", () => {
    const row = toCardRow(cardFixture, new Date("2026-08-02T00:00:00Z"));
    expect(row.setCode).toBe("blb");
  });

  it("stamps both createdAt and updatedAt with the given timestamp", () => {
    const now = new Date("2026-08-02T00:00:00Z");
    const row = toCardRow(cardFixture, now);
    expect(row.createdAt).toBe(now);
    expect(row.updatedAt).toBe(now);
  });

  it("falls back to null for fields absent on this printing", () => {
    const { artist: _artist, ...withoutArtist } = cardFixture;
    const row = toCardRow({ ...withoutArtist }, new Date());
    expect(row.artist).toBeNull();
  });
});
