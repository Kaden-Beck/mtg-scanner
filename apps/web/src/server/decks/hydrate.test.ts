import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCard } from "./test-cards";

let dir: string;

const tanaId = "6b3f2a4d-5c1e-4a8b-9d2f-7e0c3b5a1d84";
const sidarId = "2c9e7f14-8a3b-4d6e-b1f0-9c4a2e8d5b73";
const soloId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-deck-hydrate-test-"));
  process.env["DATABASE_PATH"] = join(dir, "test.db");
  process.env["DRIZZLE_MIGRATIONS_FOLDER"] = join(import.meta.dirname, "../../../drizzle");
});

afterEach(() => {
  globalThis.__mtgSqlite?.close();
  globalThis.__mtgSqlite = undefined;
  globalThis.__mtgDb = undefined;
  rmSync(dir, { recursive: true, force: true });
  delete process.env["DATABASE_PATH"];
  delete process.env["DRIZZLE_MIGRATIONS_FOLDER"];
});

async function seed() {
  const { db } = await import("../db/client");
  const { cards } = await import("../db/schema");
  db.insert(cards)
    .values([
      buildCard(tanaId, {
        name: "Tana the Bloodsower",
        colorIdentity: ["R", "G"],
        keywords: ["Partner"],
        typeLine: "Legendary Creature — Elf Druid",
      }),
      buildCard(sidarId, {
        name: "Sidar Kondo of Jamuraa",
        colorIdentity: ["G", "W"],
        keywords: ["Partner"],
        typeLine: "Legendary Creature — Human Soldier",
      }),
      buildCard(soloId, {
        name: "Yeva, Nature's Herald",
        colorIdentity: ["G"],
        typeLine: "Legendary Creature — Elf Shaman",
      }),
    ])
    .run();
}

describe("deckColorIdentity", () => {
  it("is empty for a deck with no commander", async () => {
    await seed();
    const { createDeck } = await import("./decks");
    const { deckColorIdentity } = await import("./hydrate");
    const { createDeckRequestSchema } = await import("@mtg/schemas");

    const deck = createDeck(createDeckRequestSchema.parse({ name: "Unset" }));
    expect(deckColorIdentity(deck)).toEqual([]);
  });

  it("derives from a single commander", async () => {
    await seed();
    const { createDeck } = await import("./decks");
    const { deckColorIdentity } = await import("./hydrate");
    const { createDeckRequestSchema } = await import("@mtg/schemas");

    const deck = createDeck(
      createDeckRequestSchema.parse({ name: "Yeva", commanderCardId: soloId }),
    );
    expect(deckColorIdentity(deck)).toEqual(["G"]);
  });

  it("combines partner identities", async () => {
    await seed();
    const { createDeck } = await import("./decks");
    const { deckColorIdentity } = await import("./hydrate");
    const { createDeckRequestSchema } = await import("@mtg/schemas");

    const deck = createDeck(
      createDeckRequestSchema.parse({
        name: "Tana & Sidar",
        commanderCardId: tanaId,
        partnerCardId: sidarId,
      }),
    );
    expect(deckColorIdentity(deck)).toEqual(["W", "R", "G"]);
  });

  it("re-derives after the commander changes rather than caching", async () => {
    await seed();
    const { createDeck, updateDeck } = await import("./decks");
    const { deckColorIdentity } = await import("./hydrate");
    const { createDeckRequestSchema } = await import("@mtg/schemas");

    const deck = createDeck(
      createDeckRequestSchema.parse({ name: "Switch", commanderCardId: soloId }),
    );
    expect(deckColorIdentity(deck)).toEqual(["G"]);

    const { scryfallIdSchema } = await import("@mtg/schemas");
    const updated = updateDeck(deck.id, { commanderCardId: scryfallIdSchema.parse(tanaId) });
    if (!updated) throw new Error("expected the deck to exist after update");
    expect(deckColorIdentity(updated)).toEqual(["R", "G"]);
  });

  it("picks up a color-identity erratum from a later sync with no user action", async () => {
    // KAD-28's reason for deriving on read rather than storing: the bulk
    // ingest rewrites `cards`, and the deck must follow without re-entry.
    await seed();
    const { createDeck } = await import("./decks");
    const { deckColorIdentity } = await import("./hydrate");
    const { createDeckRequestSchema } = await import("@mtg/schemas");
    const { db } = await import("../db/client");
    const { cards } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");

    const deck = createDeck(
      createDeckRequestSchema.parse({ name: "Errata", commanderCardId: soloId }),
    );
    expect(deckColorIdentity(deck)).toEqual(["G"]);

    db.update(cards).set({ colorIdentity: ["G", "U"] }).where(eq(cards.id, soloId)).run();

    expect(deckColorIdentity(deck)).toEqual(["U", "G"]);
  });
});

describe("loadDeckCommanders", () => {
  it("copes with the same printing in both slots", async () => {
    await seed();
    const { createDeck } = await import("./decks");
    const { loadDeckCommanders } = await import("./hydrate");
    const { createDeckRequestSchema } = await import("@mtg/schemas");

    const deck = createDeck(
      createDeckRequestSchema.parse({
        name: "Same card twice",
        commanderCardId: tanaId,
        partnerCardId: tanaId,
      }),
    );

    const { commander, partner } = loadDeckCommanders(deck);
    expect(commander?.id).toBe(tanaId);
    expect(partner?.id).toBe(tanaId);
  });
});

describe("hydrateDeckById", () => {
  it("returns undefined for an unknown deck", async () => {
    await seed();
    const { hydrateDeckById } = await import("./hydrate");
    expect(hydrateDeckById("00000000-0000-4000-8000-000000000000")).toBeUndefined();
  });

  it("attaches the derived identity to the row", async () => {
    await seed();
    const { createDeck } = await import("./decks");
    const { hydrateDeckById } = await import("./hydrate");
    const { createDeckRequestSchema } = await import("@mtg/schemas");

    const deck = createDeck(
      createDeckRequestSchema.parse({
        name: "Hydrated",
        commanderCardId: tanaId,
        partnerCardId: sidarId,
      }),
    );

    expect(hydrateDeckById(deck.id)?.colorIdentity).toEqual(["W", "R", "G"]);
  });
});
