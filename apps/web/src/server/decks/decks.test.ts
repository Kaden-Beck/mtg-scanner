import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scryfallIdSchema } from "@mtg/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCard } from "./test-cards";

let dir: string;

// Real crypto.randomUUID()-shaped values: `z.uuid()` enforces the version and
// variant nibbles, so a memorable 1111-1111 placeholder fails to parse even
// though the plain-text column would accept it.
const commanderId = scryfallIdSchema.parse("6b3f2a4d-5c1e-4a8b-9d2f-7e0c3b5a1d84");
const partnerId = scryfallIdSchema.parse("2c9e7f14-8a3b-4d6e-b1f0-9c4a2e8d5b73");
const cardId = scryfallIdSchema.parse("f47ac10b-58cc-4372-a567-0e02b2c3d479");
const otherCardId = scryfallIdSchema.parse("9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d");
const missingCardId = scryfallIdSchema.parse("00000000-0000-4000-8000-000000000000");

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-decks-unit-test-"));
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

async function seedCards() {
  const { db } = await import("../db/client");
  const { cards } = await import("../db/schema");
  db.insert(cards)
    .values([
      buildCard(commanderId, { name: "Sidar Kondo of Jamuraa" }),
      buildCard(partnerId, { name: "Tana the Bloodsower" }),
      buildCard(cardId, { name: "Llanowar Elves" }),
      buildCard(otherCardId, { name: "Sol Ring" }),
    ])
    .run();
}

describe("createDeck", () => {
  it("defaults format to commander and stores an empty description", async () => {
    await seedCards();
    const { createDeck } = await import("./decks");
    const { createDeckRequestSchema } = await import("@mtg/schemas");

    const deck = createDeck(createDeckRequestSchema.parse({ name: "Tana & Sidar" }));

    expect(deck.name).toBe("Tana & Sidar");
    expect(deck.format).toBe("commander");
    expect(deck.description).toBe("");
    expect(deck.commanderCardId).toBeNull();
  });

  it("stores commander and partner references", async () => {
    await seedCards();
    const { createDeck } = await import("./decks");
    const { createDeckRequestSchema } = await import("@mtg/schemas");

    const deck = createDeck(
      createDeckRequestSchema.parse({
        name: "Partners",
        commanderCardId: commanderId,
        partnerCardId: partnerId,
      }),
    );

    expect(deck.commanderCardId).toBe(commanderId);
    expect(deck.partnerCardId).toBe(partnerId);
  });

  it("rejects a commander that is not a known printing", async () => {
    await seedCards();
    const { CardNotFoundError, createDeck } = await import("./decks");
    const { createDeckRequestSchema } = await import("@mtg/schemas");

    expect(() =>
      createDeck(
        createDeckRequestSchema.parse({ name: "Ghost", commanderCardId: missingCardId }),
      ),
    ).toThrow(CardNotFoundError);
  });
});

describe("updateDeck", () => {
  it("clears a commander when explicitly set to null", async () => {
    await seedCards();
    const { createDeck, updateDeck } = await import("./decks");
    const { createDeckRequestSchema } = await import("@mtg/schemas");

    const deck = createDeck(
      createDeckRequestSchema.parse({ name: "Solo", commanderCardId: commanderId }),
    );
    const updated = updateDeck(deck.id, { commanderCardId: null });

    expect(updated?.commanderCardId).toBeNull();
  });

  it("leaves a commander alone when the key is absent", async () => {
    await seedCards();
    const { createDeck, updateDeck } = await import("./decks");
    const { createDeckRequestSchema } = await import("@mtg/schemas");

    const deck = createDeck(
      createDeckRequestSchema.parse({ name: "Solo", commanderCardId: commanderId }),
    );
    const updated = updateDeck(deck.id, { name: "Renamed" });

    expect(updated?.name).toBe("Renamed");
    expect(updated?.commanderCardId).toBe(commanderId);
  });

  it("returns undefined for an unknown deck", async () => {
    await seedCards();
    const { updateDeck } = await import("./decks");
    expect(updateDeck(missingCardId, { name: "Nope" })).toBeUndefined();
  });
});

describe("deleteDeck", () => {
  it("cascades to deck cards", async () => {
    await seedCards();
    const { addOrMergeDeckCard, createDeck, deleteDeck } = await import("./decks");
    const { createDeckCardRequestSchema, createDeckRequestSchema } = await import("@mtg/schemas");
    const { db } = await import("../db/client");
    const { deckCards } = await import("../db/schema");

    const deck = createDeck(createDeckRequestSchema.parse({ name: "Doomed" }));
    addOrMergeDeckCard(
      deck.id,
      createDeckCardRequestSchema.parse({ scryfallId: cardId, quantity: 1 }),
    );

    expect(deleteDeck(deck.id)).toBe(true);
    expect(db.select().from(deckCards).all()).toHaveLength(0);
  });
});

describe("addOrMergeDeckCard", () => {
  it("increments quantity when the same card is added to the same board", async () => {
    await seedCards();
    const { addOrMergeDeckCard, createDeck, listDeckCards } = await import("./decks");
    const { createDeckCardRequestSchema, createDeckRequestSchema } = await import("@mtg/schemas");

    const deck = createDeck(createDeckRequestSchema.parse({ name: "Merge" }));
    addOrMergeDeckCard(
      deck.id,
      createDeckCardRequestSchema.parse({ scryfallId: cardId, quantity: 1 }),
    );
    const merged = addOrMergeDeckCard(
      deck.id,
      createDeckCardRequestSchema.parse({ scryfallId: cardId, quantity: 3 }),
    );

    expect(merged.quantity).toBe(4);
    expect(listDeckCards(deck.id)).toHaveLength(1);
  });

  it("keeps the same card on different boards as separate entries", async () => {
    await seedCards();
    const { addOrMergeDeckCard, createDeck, listDeckCards } = await import("./decks");
    const { createDeckCardRequestSchema, createDeckRequestSchema } = await import("@mtg/schemas");

    const deck = createDeck(createDeckRequestSchema.parse({ name: "Boards" }));
    addOrMergeDeckCard(
      deck.id,
      createDeckCardRequestSchema.parse({ scryfallId: cardId, board: "main", quantity: 1 }),
    );
    addOrMergeDeckCard(
      deck.id,
      createDeckCardRequestSchema.parse({ scryfallId: cardId, board: "maybe", quantity: 1 }),
    );

    expect(listDeckCards(deck.id)).toHaveLength(2);
  });

  it("overwrites the category on merge rather than keeping the old one", async () => {
    await seedCards();
    const { addOrMergeDeckCard, createDeck } = await import("./decks");
    const { createDeckCardRequestSchema, createDeckRequestSchema } = await import("@mtg/schemas");

    const deck = createDeck(createDeckRequestSchema.parse({ name: "Categories" }));
    addOrMergeDeckCard(
      deck.id,
      createDeckCardRequestSchema.parse({ scryfallId: cardId, category: "ramp", quantity: 1 }),
    );
    const merged = addOrMergeDeckCard(
      deck.id,
      createDeckCardRequestSchema.parse({
        scryfallId: cardId,
        category: "mana dorks",
        quantity: 1,
      }),
    );

    expect(merged.category).toBe("mana dorks");
  });

  it("rejects an unknown deck", async () => {
    await seedCards();
    const { addOrMergeDeckCard, DeckNotFoundError } = await import("./decks");
    const { createDeckCardRequestSchema } = await import("@mtg/schemas");

    expect(() =>
      addOrMergeDeckCard(
        missingCardId,
        createDeckCardRequestSchema.parse({ scryfallId: cardId, quantity: 1 }),
      ),
    ).toThrow(DeckNotFoundError);
  });
});

describe("updateDeckCard", () => {
  it("reports a conflict when moving a card onto a board it already occupies", async () => {
    await seedCards();
    const { addOrMergeDeckCard, createDeck, updateDeckCard } = await import("./decks");
    const { createDeckCardRequestSchema, createDeckRequestSchema } = await import("@mtg/schemas");

    const deck = createDeck(createDeckRequestSchema.parse({ name: "Conflict" }));
    addOrMergeDeckCard(
      deck.id,
      createDeckCardRequestSchema.parse({ scryfallId: cardId, board: "main", quantity: 1 }),
    );
    const maybe = addOrMergeDeckCard(
      deck.id,
      createDeckCardRequestSchema.parse({ scryfallId: cardId, board: "maybe", quantity: 1 }),
    );

    expect(updateDeckCard(maybe.id, { board: "main" })).toEqual({ outcome: "conflict" });
  });

  it("re-categorises in place without forking the entry", async () => {
    await seedCards();
    const { addOrMergeDeckCard, createDeck, listDeckCards, updateDeckCard } = await import(
      "./decks"
    );
    const { createDeckCardRequestSchema, createDeckRequestSchema } = await import("@mtg/schemas");

    const deck = createDeck(createDeckRequestSchema.parse({ name: "Recategorise" }));
    const entry = addOrMergeDeckCard(
      deck.id,
      createDeckCardRequestSchema.parse({ scryfallId: otherCardId, category: "ramp", quantity: 1 }),
    );

    const result = updateDeckCard(entry.id, { category: "artifacts" });

    expect(result).toMatchObject({ outcome: "updated" });
    expect(listDeckCards(deck.id)).toHaveLength(1);
  });
});
