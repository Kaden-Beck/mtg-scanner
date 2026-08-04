import type { CardRow } from "../db/schema";

/**
 * Card fixture builder for the deck stories (KAD-26/28/30/31).
 *
 * The existing suites each carry their own inline `seedCard`, which is fine
 * when a test only needs "a card that exists". The deck work needs cards that
 * differ in the columns the rules actually read - `colorIdentity`, `keywords`,
 * `typeLine`, `oracleText`, `legalities` - so a builder with overrides beats
 * a twelfth copy-paste with four fields edited.
 *
 * Not a `.test.ts` file on purpose: Vitest's node project globs `*.test.ts`,
 * and a fixture module with no tests in it would fail the run as an empty
 * suite.
 */
/** Returns a full `CardRow` rather than `NewCardRow` so it can stand in for
 * a selected row too (the deck view needs one); `CardRow` is assignable to
 * `NewCardRow`, so inserts still take it. */
export function buildCard(id: string, overrides: Partial<CardRow> = {}): CardRow {
  const now = new Date();
  return {
    id,
    oracleId: null,
    name: "Forest",
    layout: "normal",
    manaCost: "",
    cmc: 0,
    typeLine: "Basic Land — Forest",
    oracleText: null,
    colors: [],
    colorIdentity: ["G"],
    keywords: [],
    // Empty rather than `{ commander: "legal" }`: a fixture that is legal by
    // default hides banlist bugs, so each test states the legality it means.
    legalities: {},
    games: ["paper"],
    reserved: false,
    setCode: "blb",
    setName: "Bloomburrow",
    setType: "expansion",
    collectorNumber: "280",
    rarity: "common",
    releasedAt: "2024-08-02",
    artist: null,
    borderColor: "black",
    frame: "2015",
    fullArt: true,
    textless: false,
    promo: false,
    variation: false,
    finishes: ["nonfoil", "foil"],
    cardFaces: null,
    imageUris: null,
    scryfallUri: "https://scryfall.com/card/blb/280/forest",
    prices: {},
    illustrationId: null,
    artPhash: null,
    fullPhash: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
