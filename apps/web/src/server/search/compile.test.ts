import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseQuery } from "@mtg/query-parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewCardRow } from "../db/schema";

let dir: string;

beforeEach(async () => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-compile-test-"));
  process.env["DATABASE_PATH"] = join(dir, "test.db");
  process.env["DRIZZLE_MIGRATIONS_FOLDER"] = join(import.meta.dirname, "../../../drizzle");
  await seedFixtures();
});

afterEach(() => {
  globalThis.__mtgSqlite?.close();
  globalThis.__mtgSqlite = undefined;
  globalThis.__mtgDb = undefined;
  rmSync(dir, { recursive: true, force: true });
  delete process.env["DATABASE_PATH"];
  delete process.env["DRIZZLE_MIGRATIONS_FOLDER"];
});

/**
 * Pinned fixtures, chosen so each one is the sole answer to at least one
 * predicate. The colors/identity spread is deliberate: Khalni Garden has
 * an empty `colors` but a green `colorIdentity`, which is the only way to
 * tell a correct `c:` apart from a correct `id:`.
 */
const CARD_FIXTURES: readonly (Partial<NewCardRow> & { id: string; name: string })[] = [
  {
    id: "0000419b-0bba-4488-8f7a-6194544ce91e",
    name: "Lightning Bolt",
    typeLine: "Instant",
    oracleText: "Lightning Bolt deals 3 damage to any target.",
    colors: ["R"],
    colorIdentity: ["R"],
    cmc: 1,
    setCode: "lea",
    rarity: "common",
    finishes: ["nonfoil"],
  },
  {
    id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    name: "Llanowar Elves",
    typeLine: "Creature — Elf Druid",
    oracleText: "{T}: Add {G}.",
    colors: ["G"],
    colorIdentity: ["G"],
    cmc: 1,
    setCode: "lea",
    rarity: "common",
    finishes: ["nonfoil", "foil"],
  },
  {
    id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
    name: "Manamorphose",
    typeLine: "Instant",
    oracleText: "Add two mana in any combination of colors. Draw a card.",
    colors: ["R", "G"],
    colorIdentity: ["R", "G"],
    cmc: 2,
    setCode: "shm",
    rarity: "common",
    finishes: ["nonfoil"],
  },
  {
    id: "3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f",
    name: "Sol Ring",
    typeLine: "Artifact",
    oracleText: "{T}: Add {C}{C}.",
    colors: [],
    colorIdentity: [],
    cmc: 1,
    setCode: "lea",
    rarity: "uncommon",
    reserved: true,
    finishes: ["nonfoil"],
  },
  {
    id: "4d5e6f7a-8b9c-4d0e-9f1a-3b4c5d6e7f8a",
    name: "Khalni Garden",
    typeLine: "Land",
    oracleText: "Khalni Garden enters tapped.",
    colors: [],
    colorIdentity: ["G"],
    cmc: 0,
    setCode: "zen",
    rarity: "common",
    finishes: ["nonfoil"],
  },
  {
    id: "5e6f7a8b-9c0d-4e1f-a2b3-4c5d6e7f8a9b",
    name: "Sliver Queen",
    typeLine: "Legendary Creature — Sliver",
    oracleText: "{2}: Create a 1/1 colorless Sliver creature token.",
    colors: ["W", "U", "B", "R", "G"],
    colorIdentity: ["W", "U", "B", "R", "G"],
    cmc: 7,
    setCode: "stf",
    rarity: "rare",
    reserved: true,
    finishes: ["nonfoil"],
  },
  {
    // Deliberately null oracle text: `-o:...` must not silently drop rows
    // whose oracle_text is NULL (NOT NULL is NULL, not TRUE, in SQL).
    id: "6f7a8b9c-0d1e-4f2a-b3c4-5d6e7f8a9b0c",
    name: "Grizzly Bears",
    typeLine: "Creature — Bear",
    oracleText: null,
    colors: ["G"],
    colorIdentity: ["G"],
    cmc: 2,
    setCode: "lea",
    rarity: "common",
    finishes: ["nonfoil"],
  },
  {
    // No collection_items row - proves the join actually filters.
    id: "7a8b9c0d-1e2f-4a3b-8c4d-6e7f8a9b0c1d",
    name: "Black Lotus",
    typeLine: "Artifact",
    oracleText: "{T}, Sacrifice Black Lotus: Add three mana of any one color.",
    colors: [],
    colorIdentity: [],
    cmc: 0,
    setCode: "lea",
    rarity: "rare",
    reserved: true,
    finishes: ["nonfoil"],
  },
];

const STACK_FIXTURES: readonly {
  scryfallId: string;
  binderLocation: string;
  condition: "NM" | "LP" | "MP" | "HP" | "DMG";
  finish: "nonfoil" | "foil" | "etched";
}[] = [
  {
    scryfallId: "0000419b-0bba-4488-8f7a-6194544ce91e",
    binderLocation: "Box 1",
    condition: "NM",
    finish: "nonfoil",
  },
  {
    scryfallId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    binderLocation: "Box 2",
    condition: "LP",
    finish: "foil",
  },
  {
    scryfallId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
    binderLocation: "Box 1",
    condition: "NM",
    finish: "nonfoil",
  },
  {
    scryfallId: "3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f",
    binderLocation: "Commander Deck",
    condition: "MP",
    finish: "nonfoil",
  },
  {
    scryfallId: "4d5e6f7a-8b9c-4d0e-9f1a-3b4c5d6e7f8a",
    binderLocation: "Box 2",
    condition: "NM",
    finish: "nonfoil",
  },
  {
    scryfallId: "5e6f7a8b-9c0d-4e1f-a2b3-4c5d6e7f8a9b",
    binderLocation: "Vault",
    condition: "NM",
    finish: "nonfoil",
  },
  {
    scryfallId: "6f7a8b9c-0d1e-4f2a-b3c4-5d6e7f8a9b0c",
    binderLocation: "Box 2",
    condition: "NM",
    finish: "nonfoil",
  },
];

async function seedFixtures(): Promise<void> {
  const { db } = await import("../db/client");
  const { cards, collectionItems } = await import("../db/schema");
  const now = new Date();

  for (const fixture of CARD_FIXTURES) {
    await db.insert(cards).values({
      oracleId: null,
      layout: "normal",
      manaCost: "",
      cmc: 0,
      typeLine: "Instant",
      oracleText: null,
      colors: [],
      colorIdentity: [],
      keywords: [],
      legalities: {},
      games: ["paper"],
      reserved: false,
      setCode: "lea",
      setName: "Limited Edition Alpha",
      setType: "core",
      collectorNumber: "1",
      rarity: "common",
      releasedAt: "1993-08-05",
      artist: "Test Artist",
      borderColor: "black",
      frame: "1993",
      fullArt: false,
      textless: false,
      promo: false,
      variation: false,
      finishes: ["nonfoil"],
      cardFaces: null,
      imageUris: null,
      scryfallUri: `https://scryfall.com/card/${fixture.id}`,
      prices: {},
      createdAt: now,
      updatedAt: now,
      ...fixture,
    });
  }

  for (const stack of STACK_FIXTURES) {
    await db.insert(collectionItems).values({
      id: randomUUID(),
      quantity: 1,
      isProxy: false,
      language: "en",
      createdAt: now,
      updatedAt: now,
      ...stack,
    });
  }
}

/** Parses, compiles, runs, and returns the matched card names (name-ordered). */
async function search(query: string): Promise<string[]> {
  const { searchCollection } = await import("./collection-search");
  return searchCollection(parseQuery(query)).map((row) => row.card.name);
}

describe("compileQuery — color and identity (subset/superset)", () => {
  const cases: readonly [query: string, expected: string[]][] = [
    // A bare `:` is `>=` — "at least these colors, possibly more".
    ["c:r", ["Lightning Bolt", "Manamorphose", "Sliver Queen"]],
    ["c:g", ["Grizzly Bears", "Llanowar Elves", "Manamorphose", "Sliver Queen"]],
    ["c:rg", ["Manamorphose", "Sliver Queen"]],
    ["c>=rg", ["Manamorphose", "Sliver Queen"]],
    // `=` is exact.
    ["c=rg", ["Manamorphose"]],
    // `<=` is "nothing outside this set", so colorless cards qualify.
    [
      "c<=rg",
      [
        "Grizzly Bears",
        "Khalni Garden",
        "Lightning Bolt",
        "Llanowar Elves",
        "Manamorphose",
        "Sol Ring",
      ],
    ],
    ["c>rg", ["Sliver Queen"]],
    ["c<rg", ["Grizzly Bears", "Khalni Garden", "Lightning Bolt", "Llanowar Elves", "Sol Ring"]],
    [
      "c!=rg",
      [
        "Grizzly Bears",
        "Khalni Garden",
        "Lightning Bolt",
        "Llanowar Elves",
        "Sliver Queen",
        "Sol Ring",
      ],
    ],
    // Colorless: `>=` over an empty set would be vacuously true, so `c:c`
    // is read as `c=c` instead.
    ["c:c", ["Khalni Garden", "Sol Ring"]],
    ["c:colorless", ["Khalni Garden", "Sol Ring"]],
    // The distinction that only a correct c-vs-id split can make: Khalni
    // Garden has no colors but a green identity.
    ["id:g", ["Grizzly Bears", "Khalni Garden", "Llanowar Elves", "Manamorphose", "Sliver Queen"]],
    ["id=g", ["Grizzly Bears", "Khalni Garden", "Llanowar Elves"]],
  ];

  it.each(cases)("%s", async (query, expected) => {
    expect(await search(query)).toEqual(expected);
  });

  it("treats c:wurbg and c=wurbg as equivalent at the maximal set", async () => {
    // Nothing can be a proper superset of all five colors, so ">= all" and
    // "== all" must select the same rows.
    expect(await search("c:wubrg")).toEqual(["Sliver Queen"]);
    expect(await search("c=wubrg")).toEqual(["Sliver Queen"]);
  });

  it("ignores the order and case of color letters", async () => {
    expect(await search("c:GR")).toEqual(await search("c:rg"));
  });
});

describe("compileQuery — text operators", () => {
  const cases: readonly [query: string, expected: string[]][] = [
    ["t:instant", ["Lightning Bolt", "Manamorphose"]],
    ['t:"elf druid"', ["Llanowar Elves"]],
    ["t:creature", ["Grizzly Bears", "Llanowar Elves", "Sliver Queen"]],
    ["t=instant", ["Lightning Bolt", "Manamorphose"]],
    ["o:damage", ["Lightning Bolt"]],
    ['o:"draw a card"', ["Manamorphose"]],
    // Bare words are an implicit name search.
    ["bolt", ["Lightning Bolt"]],
    ['"Sliver Queen"', ["Sliver Queen"]],
    ["set:lea", ["Grizzly Bears", "Lightning Bolt", "Llanowar Elves", "Sol Ring"]],
    ["e:LEA", ["Grizzly Bears", "Lightning Bolt", "Llanowar Elves", "Sol Ring"]],
    ["r:rare", ["Sliver Queen"]],
    ["rarity:uncommon", ["Sol Ring"]],
    ['binder:"box 1"', ["Lightning Bolt", "Manamorphose"]],
    ["condition:LP", ["Llanowar Elves"]],
    [
      "condition:nm",
      ["Grizzly Bears", "Khalni Garden", "Lightning Bolt", "Manamorphose", "Sliver Queen"],
    ],
  ];

  it.each(cases)("%s", async (query, expected) => {
    expect(await search(query)).toEqual(expected);
  });

  it("keeps NULL oracle text in the results of a negated oracle search", async () => {
    // `NOT (NULL LIKE ...)` is NULL, not TRUE — without a coalesce, Grizzly
    // Bears would silently vanish from every `-o:` search.
    expect(await search("-o:damage")).toContain("Grizzly Bears");
  });
});

describe("compileQuery — is:, cmc, and owned:", () => {
  const cases: readonly [query: string, expected: string[]][] = [
    ["is:reserved", ["Sliver Queen", "Sol Ring"]],
    [
      "-is:reserved",
      ["Grizzly Bears", "Khalni Garden", "Lightning Bolt", "Llanowar Elves", "Manamorphose"],
    ],
    ["is:foil", ["Llanowar Elves"]],
    [
      "is:nonfoil",
      [
        "Grizzly Bears",
        "Khalni Garden",
        "Lightning Bolt",
        "Llanowar Elves",
        "Manamorphose",
        "Sliver Queen",
        "Sol Ring",
      ],
    ],
    ["cmc:1", ["Lightning Bolt", "Llanowar Elves", "Sol Ring"]],
    ["cmc=1", ["Lightning Bolt", "Llanowar Elves", "Sol Ring"]],
    ["cmc>=2", ["Grizzly Bears", "Manamorphose", "Sliver Queen"]],
    ["cmc<1", ["Khalni Garden"]],
    ["cmc>6", ["Sliver Queen"]],
  ];

  it.each(cases)("%s", async (query, expected) => {
    expect(await search(query)).toEqual(expected);
  });

  it("treats owned: as a no-op in the collection context", async () => {
    const { searchCollection } = await import("./collection-search");
    expect(await search("owned:true")).toEqual(searchCollection(null).map((row) => row.card.name));
    expect(await search("owned:false")).toEqual([]);
  });
});

describe("compileQuery — boolean composition", () => {
  const cases: readonly [query: string, expected: string[]][] = [
    ["c:g t:creature", ["Grizzly Bears", "Llanowar Elves", "Sliver Queen"]],
    ["c:g AND t:creature", ["Grizzly Bears", "Llanowar Elves", "Sliver Queen"]],
    ["t:instant OR t:land", ["Khalni Garden", "Lightning Bolt", "Manamorphose"]],
    ["c:g -t:creature", ["Manamorphose"]],
    ["(t:instant OR t:artifact) cmc:1", ["Lightning Bolt", "Sol Ring"]],
    ["set:lea -is:reserved cmc<2", ["Lightning Bolt", "Llanowar Elves"]],
    ["-(t:creature OR t:instant)", ["Khalni Garden", "Sol Ring"]],
  ];

  it.each(cases)("%s", async (query, expected) => {
    expect(await search(query)).toEqual(expected);
  });
});

describe("compileQuery — base query shape", () => {
  it("returns one row per owned stack and excludes unowned printings", async () => {
    const { searchCollection } = await import("./collection-search");
    const names = searchCollection(null).map((row) => row.card.name);
    expect(names).toHaveLength(STACK_FIXTURES.length);
    expect(names).not.toContain("Black Lotus");
  });

  it("exposes both the stack and its printing", async () => {
    const { searchCollection } = await import("./collection-search");
    const [row] = searchCollection(parseQuery("bolt"));
    expect(row?.card.name).toBe("Lightning Bolt");
    expect(row?.item.binderLocation).toBe("Box 1");
  });
});

describe("compileQuery — user input never reaches SQL unparameterized", () => {
  it("treats LIKE wildcards in user input as literal characters", async () => {
    // Unescaped, `%` would match every card in the collection.
    expect(await search("%")).toEqual([]);
    expect(await search("_")).toEqual([]);
    expect(await search("t:%")).toEqual([]);
  });

  it("survives a SQL injection attempt without executing it", async () => {
    expect(await search(`o:"'; DROP TABLE cards; --"`)).toEqual([]);

    const { searchCollection } = await import("./collection-search");
    expect(searchCollection(null)).toHaveLength(STACK_FIXTURES.length);
  });

  it("matches a literal percent sign when one is actually in the data", async () => {
    const { db } = await import("../db/client");
    const { cards } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(cards)
      .set({ name: "100% Bolt" })
      .where(eq(cards.id, "0000419b-0bba-4488-8f7a-6194544ce91e"));

    expect(await search("100%")).toEqual(["100% Bolt"]);
  });
});

/**
 * These assertions import the error classes dynamically, from the same
 * fresh module graph the compiler was loaded into. `vi.resetModules()`
 * gives each test its own copy of `@mtg/query-parser`, so a statically
 * imported `QuerySyntaxError` is a *different class object* than the one
 * the compiler throws and `instanceof` would fail for the wrong reason.
 */
describe("compileQuery — explicit errors (KAD-18)", () => {
  const syntaxCases: readonly [label: string, query: string, messagePart: string][] = [
    ["an unknown is: value", "is:bogus", "isn't a supported filter"],
    ["a non-numeric cmc", "cmc>=abc", "needs a numeric value"],
    ["a bad color letter", "c:xyz", "isn't a color"],
    ["an unknown condition", "condition:PERFECT", "isn't a known condition"],
    ["a non-boolean owned:", "owned:maybe", "use owned:true or owned:false"],
    ["an ordering comparator on a text field", "t>creature", 'doesn\'t support the ">" comparator'],
    ["an ordering comparator on rarity", "r>rare", 'doesn\'t support the ">" comparator'],
  ];

  it.each(syntaxCases)("names the problem for %s", async (_label, query, messagePart) => {
    const { searchCollection } = await import("./collection-search");
    const { QuerySyntaxError } = await import("@mtg/query-parser");
    expect(() => searchCollection(parseQuery(query))).toThrow(QuerySyntaxError);
    expect(() => searchCollection(parseQuery(query))).toThrow(messagePart);
  });

  it("tells the user tag: is coming rather than failing vaguely", async () => {
    const { searchCollection } = await import("./collection-search");
    const { UnimplementedOperatorError } = await import("@mtg/query-parser");
    expect(() => searchCollection(parseQuery("tag:combo"))).toThrow(UnimplementedOperatorError);
    expect(() => searchCollection(parseQuery("tag:combo"))).toThrow("Sprint 4 (KAD-22)");
  });
});
