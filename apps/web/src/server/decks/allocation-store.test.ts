import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DeckBoard, type ScryfallId, scryfallIdSchema } from "@mtg/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCard } from "./test-cards";

/**
 * Integration tests for allocation and cross-deck conflict (KAD-33), against
 * a real SQLite file.
 *
 * The AC asks specifically for over-allocation edge cases, and those are the
 * ones that cannot be reached from the pure tests: they need two decks, a
 * shared physical stack, and the write path that actually populates
 * `deck_allocations`.
 */

let dir: string;

const solRingA = scryfallIdSchema.parse("6b3f2a4d-5c1e-4a8b-9d2f-7e0c3b5a1d84");
const solRingB = scryfallIdSchema.parse("2c9e7f14-8a3b-4d6e-b1f0-9c4a2e8d5b73");
const elves = scryfallIdSchema.parse("f47ac10b-58cc-4372-a567-0e02b2c3d479");

const SOL_RING_ORACLE = "0d1b1cb6-e5a1-4b6f-9a0d-2f3c4b5a6d7e";
const ELVES_ORACLE = "1e2c3d4f-6b7a-4c8d-9e0f-3a4b5c6d7e8f";

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-allocation-test-"));
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
      buildCard(solRingA, { name: "Sol Ring", oracleId: SOL_RING_ORACLE, setCode: "c19" }),
      buildCard(solRingB, { name: "Sol Ring", oracleId: SOL_RING_ORACLE, setCode: "kld" }),
      buildCard(elves, { name: "Llanowar Elves", oracleId: ELVES_ORACLE }),
    ])
    .run();
}

let stackCounter = 0;

async function seedStack(
  scryfallId: string,
  quantity: number,
  binderLocation = "",
): Promise<string> {
  const { db } = await import("../db/client");
  const { collectionItems } = await import("../db/schema");
  stackCounter += 1;
  const id = `stack-${String(stackCounter)}`;
  const now = new Date();
  db.insert(collectionItems)
    .values({
      id,
      scryfallId,
      finish: "nonfoil",
      condition: "NM",
      quantity,
      isProxy: false,
      binderLocation,
      language: "en",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

/** Creates a deck through the real write path, so allocations get synced. */
async function seedDeck(
  name: string,
  entries: { scryfallId: ScryfallId; quantity: number; board?: DeckBoard }[],
): Promise<string> {
  const { db } = await import("../db/client");
  const { decks } = await import("../db/schema");
  const { addOrMergeDeckCard } = await import("./decks");

  const deckId = randomUUID();
  const now = new Date();
  db.insert(decks)
    .values({
      id: deckId,
      name,
      format: "commander",
      description: "",
      commanderCardId: null,
      partnerCardId: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  for (const entry of entries) {
    addOrMergeDeckCard(deckId, {
      scryfallId: entry.scryfallId,
      board: entry.board ?? "main",
      category: "",
      quantity: entry.quantity,
    });
  }
  return deckId;
}

async function allocationsFor(deckId: string) {
  const { db } = await import("../db/client");
  const { deckAllocations } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");
  return db.select().from(deckAllocations).where(eq(deckAllocations.deckId, deckId)).all();
}

async function conflictsFor(deckId: string) {
  const { loadDeckConflicts } = await import("./allocation-store");
  return loadDeckConflicts(deckId);
}

describe("syncDeckAllocations", () => {
  it("allocates nothing for a card the user does not own", async () => {
    await seedCards();
    const deckId = await seedDeck("Deck A", [{ scryfallId: elves, quantity: 1 }]);
    expect(await allocationsFor(deckId)).toEqual([]);
  });

  it("claims the stack backing an owned card", async () => {
    await seedCards();
    const stackId = await seedStack(elves, 4);
    const deckId = await seedDeck("Deck A", [{ scryfallId: elves, quantity: 1 }]);

    const rows = await allocationsFor(deckId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.collectionItemId).toBe(stackId);
    expect(rows[0]?.quantity).toBe(1);
  });

  it("claims a different printing of the same oracle card", async () => {
    await seedCards();
    const stackId = await seedStack(solRingB, 1);
    const deckId = await seedDeck("Deck A", [{ scryfallId: solRingA, quantity: 1 }]);

    const rows = await allocationsFor(deckId);
    expect(rows[0]?.collectionItemId).toBe(stackId);
  });

  it("does not claim physical copies for a maybe-board card", async () => {
    // A card under consideration must not make a real deck look conflicted.
    await seedCards();
    await seedStack(elves, 1);
    const deckId = await seedDeck("Deck A", [{ scryfallId: elves, quantity: 1, board: "maybe" }]);
    expect(await allocationsFor(deckId)).toEqual([]);
  });

  it("is idempotent - re-running leaves the same claim", async () => {
    await seedCards();
    await seedStack(elves, 4);
    const deckId = await seedDeck("Deck A", [{ scryfallId: elves, quantity: 2 }]);
    const before = await allocationsFor(deckId);

    const { syncDeckAllocations } = await import("./allocation-store");
    syncDeckAllocations(deckId);
    const after = await allocationsFor(deckId);

    expect(after).toHaveLength(before.length);
    expect(after[0]?.collectionItemId).toBe(before[0]?.collectionItemId);
    expect(after[0]?.quantity).toBe(before[0]?.quantity);
  });

  it("follows a quantity change", async () => {
    await seedCards();
    await seedStack(elves, 4);
    const deckId = await seedDeck("Deck A", [{ scryfallId: elves, quantity: 1 }]);

    const { listDeckCards, updateDeckCard } = await import("./decks");
    const entry = listDeckCards(deckId)[0];
    if (!entry) throw new Error("expected an entry");
    updateDeckCard(entry.id, { quantity: 3 });

    expect((await allocationsFor(deckId))[0]?.quantity).toBe(3);
  });

  it("releases the claim when the card is removed", async () => {
    await seedCards();
    await seedStack(elves, 4);
    const deckId = await seedDeck("Deck A", [{ scryfallId: elves, quantity: 1 }]);

    const { listDeckCards, removeDeckCard } = await import("./decks");
    const entry = listDeckCards(deckId)[0];
    if (!entry) throw new Error("expected an entry");
    removeDeckCard(entry.id);

    expect(await allocationsFor(deckId)).toEqual([]);
  });

  it("spreads two decks across two identical copies rather than dogpiling one", async () => {
    // Manufacturing a conflict out of a collection that can satisfy both
    // decks would be worse than useless.
    await seedCards();
    await seedStack(elves, 1, "Binder 1");
    await seedStack(elves, 1, "Binder 2");

    const deckA = await seedDeck("Deck A", [{ scryfallId: elves, quantity: 1 }]);
    const deckB = await seedDeck("Deck B", [{ scryfallId: elves, quantity: 1 }]);

    const stackA = (await allocationsFor(deckA))[0]?.collectionItemId;
    const stackB = (await allocationsFor(deckB))[0]?.collectionItemId;
    expect(stackA).toBeDefined();
    expect(stackB).toBeDefined();
    expect(stackA).not.toBe(stackB);

    expect((await conflictsFor(deckA)).size).toBe(0);
    expect((await conflictsFor(deckB)).size).toBe(0);
  });

  it("does not let two entries in one deck claim the same physical copy twice", async () => {
    // Two printings of one card in the same deck. Easy to miss, because it
    // reproduces with no second deck involved.
    await seedCards();
    const stackId = await seedStack(solRingA, 1);
    const deckId = await seedDeck("Deck A", [
      { scryfallId: solRingA, quantity: 1 },
      { scryfallId: solRingB, quantity: 1 },
    ]);

    const rows = await allocationsFor(deckId);
    // One row for the one stack, claiming 2 - not two rows of 1 that hide
    // the over-subscription by looking individually reasonable.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.collectionItemId).toBe(stackId);
    expect(rows[0]?.quantity).toBe(2);
  });
});

describe("loadDeckConflicts (AC2)", () => {
  it("is silent when nothing is contended", async () => {
    await seedCards();
    await seedStack(elves, 4);
    const deckId = await seedDeck("Deck A", [{ scryfallId: elves, quantity: 1 }]);
    expect((await conflictsFor(deckId)).size).toBe(0);
  });

  it("names the competing deck when two decks want the same single copy", async () => {
    await seedCards();
    await seedStack(elves, 1);
    const deckA = await seedDeck("Atraxa", [{ scryfallId: elves, quantity: 1 }]);
    const deckB = await seedDeck("Yeva", [{ scryfallId: elves, quantity: 1 }]);

    const { listDeckCards } = await import("./decks");
    const entryA = listDeckCards(deckA)[0];
    if (!entryA) throw new Error("expected an entry");

    const conflicts = await conflictsFor(deckA);
    const forEntry = conflicts.get(entryA.id);
    expect(forEntry).toHaveLength(1);
    expect(forEntry?.[0]?.competingDecks.map((d) => d.deckName)).toEqual(["Yeva"]);
    expect(forEntry?.[0]?.shortBy).toBe(1);

    // Symmetric: Yeva sees Atraxa.
    const entryB = listDeckCards(deckB)[0];
    if (!entryB) throw new Error("expected an entry");
    expect(
      (await conflictsFor(deckB)).get(entryB.id)?.[0]?.competingDecks.map((d) => d.deckName),
    ).toEqual(["Atraxa"]);
  });

  it("is silent when two decks share a stack of two", async () => {
    await seedCards();
    await seedStack(elves, 2);
    const deckA = await seedDeck("Atraxa", [{ scryfallId: elves, quantity: 1 }]);
    await seedDeck("Yeva", [{ scryfallId: elves, quantity: 1 }]);
    expect((await conflictsFor(deckA)).size).toBe(0);
  });

  it("reports a shortfall of two when three decks want one copy", async () => {
    await seedCards();
    await seedStack(elves, 1);
    const deckA = await seedDeck("Atraxa", [{ scryfallId: elves, quantity: 1 }]);
    await seedDeck("Yeva", [{ scryfallId: elves, quantity: 1 }]);
    await seedDeck("Krenko", [{ scryfallId: elves, quantity: 1 }]);

    const { listDeckCards } = await import("./decks");
    const entry = listDeckCards(deckA)[0];
    if (!entry) throw new Error("expected an entry");

    const conflict = (await conflictsFor(deckA)).get(entry.id)?.[0];
    expect(conflict?.totalClaimed).toBe(3);
    expect(conflict?.shortBy).toBe(2);
    expect(conflict?.competingDecks.map((d) => d.deckName).sort()).toEqual(["Krenko", "Yeva"]);
  });

  it("does not report a deck's own shortfall as a conflict", async () => {
    // Deck wants 4, box holds 1, nobody else involved. KAD-32's badge
    // already says "1/4"; calling it a conflict with no competitor to name
    // would be noise.
    await seedCards();
    await seedStack(elves, 1);
    const deckId = await seedDeck("Atraxa", [{ scryfallId: elves, quantity: 4 }]);
    expect((await conflictsFor(deckId)).size).toBe(0);
  });

  it("clears once the competing deck releases the card", async () => {
    await seedCards();
    await seedStack(elves, 1);
    const deckA = await seedDeck("Atraxa", [{ scryfallId: elves, quantity: 1 }]);
    const deckB = await seedDeck("Yeva", [{ scryfallId: elves, quantity: 1 }]);

    const { listDeckCards, removeDeckCard } = await import("./decks");
    const entryA = listDeckCards(deckA)[0];
    if (!entryA) throw new Error("expected an entry");
    expect((await conflictsFor(deckA)).has(entryA.id)).toBe(true);

    const entryB = listDeckCards(deckB)[0];
    if (!entryB) throw new Error("expected an entry");
    removeDeckCard(entryB.id);

    expect((await conflictsFor(deckA)).size).toBe(0);
  });

  it("surfaces a conflict across two different printings of one card", async () => {
    // Deck A names the C19 printing, deck B the KLD one, and there is a
    // single physical copy. Printing-level reasoning would miss this
    // entirely - the two decks look like they want different cards.
    await seedCards();
    await seedStack(solRingB, 1);
    const deckA = await seedDeck("Atraxa", [{ scryfallId: solRingA, quantity: 1 }]);
    await seedDeck("Yeva", [{ scryfallId: solRingB, quantity: 1 }]);

    const { listDeckCards } = await import("./decks");
    const entry = listDeckCards(deckA)[0];
    if (!entry) throw new Error("expected an entry");

    expect(
      (await conflictsFor(deckA)).get(entry.id)?.[0]?.competingDecks.map((d) => d.deckName),
    ).toEqual(["Yeva"]);
  });

  it("appears when the collection shrinks under existing allocations", async () => {
    // Conflict is computed against the *live* stack quantity, so selling a
    // copy surfaces the conflict without re-syncing every deck that claimed
    // it.
    await seedCards();
    const stackId = await seedStack(elves, 2);
    const deckA = await seedDeck("Atraxa", [{ scryfallId: elves, quantity: 1 }]);
    await seedDeck("Yeva", [{ scryfallId: elves, quantity: 1 }]);
    expect((await conflictsFor(deckA)).size).toBe(0);

    const { db } = await import("../db/client");
    const { collectionItems } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    db.update(collectionItems).set({ quantity: 1 }).where(eq(collectionItems.id, stackId)).run();

    expect((await conflictsFor(deckA)).size).toBe(1);
  });

  it("drops allocations when the physical stack is deleted", async () => {
    // ON DELETE CASCADE, which only fires because db/client.ts sets
    // PRAGMA foreign_keys = ON.
    await seedCards();
    const stackId = await seedStack(elves, 1);
    const deckId = await seedDeck("Atraxa", [{ scryfallId: elves, quantity: 1 }]);
    expect(await allocationsFor(deckId)).toHaveLength(1);

    const { db } = await import("../db/client");
    const { collectionItems } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    db.delete(collectionItems).where(eq(collectionItems.id, stackId)).run();

    expect(await allocationsFor(deckId)).toEqual([]);
  });

  it("drops allocations when the deck is deleted", async () => {
    await seedCards();
    await seedStack(elves, 1);
    const deckA = await seedDeck("Atraxa", [{ scryfallId: elves, quantity: 1 }]);
    const deckB = await seedDeck("Yeva", [{ scryfallId: elves, quantity: 1 }]);

    const { deleteDeck, listDeckCards } = await import("./decks");
    deleteDeck(deckB);

    expect(await allocationsFor(deckB)).toEqual([]);
    // ...and Atraxa's conflict resolves itself.
    const entry = listDeckCards(deckA)[0];
    if (!entry) throw new Error("expected an entry");
    expect((await conflictsFor(deckA)).has(entry.id)).toBe(false);
  });
});
