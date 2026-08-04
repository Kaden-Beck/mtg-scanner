import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Condition, type ScryfallId, scryfallIdSchema } from "@mtg/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCard } from "./test-cards";

/**
 * "Owned only" build mode (KAD-35) and the availability annotation behind it.
 *
 * Needs a real database: the filter is applied inside the FTS query, so
 * nothing about it is reachable from a pure test.
 */

let dir: string;

const bolt = scryfallIdSchema.parse("0000419b-0bba-4488-8f7a-6194544ce91e");
const solRingA = scryfallIdSchema.parse("6b3f2a4d-5c1e-4a8b-9d2f-7e0c3b5a1d84");
const solRingB = scryfallIdSchema.parse("2c9e7f14-8a3b-4d6e-b1f0-9c4a2e8d5b73");
const rift = scryfallIdSchema.parse("9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d");

const SOL_RING_ORACLE = "0d1b1cb6-e5a1-4b6f-9a0d-2f3c4b5a6d7e";
const BOLT_ORACLE = "1e2c3d4f-6b7a-4c8d-9e0f-3a4b5c6d7e8f";

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-card-search-test-"));
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
      buildCard(bolt, {
        name: "Lightning Bolt",
        oracleId: BOLT_ORACLE,
        typeLine: "Instant",
        oracleText: "Deal 3 damage to any target.",
      }),
      buildCard(solRingA, {
        name: "Sol Ring",
        oracleId: SOL_RING_ORACLE,
        typeLine: "Artifact",
        oracleText: "Add two colorless mana.",
        setCode: "c19",
      }),
      buildCard(solRingB, {
        name: "Sol Ring",
        oracleId: SOL_RING_ORACLE,
        typeLine: "Artifact",
        oracleText: "Add two colorless mana.",
        setCode: "kld",
      }),
      // No oracle id: can only ever be matched on its own printing.
      buildCard(rift, {
        name: "Cyclonic Rift",
        oracleId: null,
        typeLine: "Instant",
        oracleText: "Return target nonland permanent.",
      }),
    ])
    .run();

  const { rebuildCardsFts } = await import("../search/fts");
  rebuildCardsFts();
}

let stackCounter = 0;

async function seedStack(
  scryfallId: ScryfallId,
  quantity: number,
  // Two stacks of the same printing have to differ somewhere - the KAD-12
  // stack index is on (scryfall_id, finish, condition, is_proxy, location,
  // language), so a second stack needs a distinct condition to exist at all.
  condition: Condition = "NM",
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
      condition,
      quantity,
      isProxy: false,
      binderLocation: "",
      language: "en",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

async function seedAllocation(collectionItemId: string, quantity: number) {
  const { db } = await import("../db/client");
  const { deckAllocations, decks } = await import("../db/schema");
  const now = new Date();
  const deckId = randomUUID();
  db.insert(decks)
    .values({
      id: deckId,
      name: `Deck ${deckId.slice(0, 4)}`,
      format: "commander",
      description: "",
      commanderCardId: null,
      partnerCardId: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(deckAllocations)
    .values({
      id: randomUUID(),
      deckId,
      collectionItemId,
      quantity,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

async function suggest(term: string, ownedOnly = false) {
  const { suggestCards } = await import("./card-search");
  return suggestCards(term, { ownedOnly });
}

describe("suggestCards without owned-only", () => {
  it("returns unowned cards, as the full catalogue should", async () => {
    await seedCards();
    const results = await suggest("Lightning");
    expect(results.map((card) => card.name)).toEqual(["Lightning Bolt"]);
    expect(results[0]?.owned).toBe(0);
  });

  it("is empty for a term shorter than a query", async () => {
    await seedCards();
    expect(await suggest("")).toEqual([]);
    expect(await suggest("   ")).toEqual([]);
  });
});

describe("owned-only build mode (AC1)", () => {
  it("excludes a card the user does not own", async () => {
    await seedCards();
    expect(await suggest("Lightning", true)).toEqual([]);
  });

  it("includes a card the user owns", async () => {
    await seedCards();
    await seedStack(bolt, 2);

    const results = await suggest("Lightning", true);
    expect(results.map((card) => card.name)).toEqual(["Lightning Bolt"]);
    expect(results[0]?.owned).toBe(2);
    expect(results[0]?.free).toBe(2);
  });

  it("offers both printings when the user owns only one of them", async () => {
    // Oracle-level, same rule as KAD-32's badge: owning the KLD Sol Ring
    // means the C19 one is a legal thing to put in a deck too.
    await seedCards();
    await seedStack(solRingB, 1);

    const results = await suggest("Sol", true);
    expect(results.map((card) => card.id).sort()).toEqual([solRingA, solRingB].sort());
    expect(results.every((card) => card.owned === 1)).toBe(true);
  });

  it("matches a card with no oracle id on its own printing", async () => {
    await seedCards();
    await seedStack(rift, 1);
    expect((await suggest("Cyclonic", true)).map((card) => card.name)).toEqual(["Cyclonic Rift"]);
  });

  it("still offers a card every copy of which is allocated elsewhere", async () => {
    // The ADR-004 call: allocation is advisory, so an already-claimed copy is
    // a legal result. A reservation model would have excluded this.
    await seedCards();
    const stackId = await seedStack(bolt, 1);
    await seedAllocation(stackId, 1);

    const results = await suggest("Lightning", true);
    expect(results.map((card) => card.name)).toEqual(["Lightning Bolt"]);
    expect(results[0]?.owned).toBe(1);
    expect(results[0]?.free).toBe(0);
  });

  it("counts partially allocated copies as partly free", async () => {
    await seedCards();
    const stackId = await seedStack(bolt, 3);
    await seedAllocation(stackId, 2);

    const results = await suggest("Lightning", true);
    expect(results[0]?.owned).toBe(3);
    expect(results[0]?.free).toBe(1);
  });

  it("never reports negative free capacity when over-allocated", async () => {
    await seedCards();
    const stackId = await seedStack(bolt, 1);
    await seedAllocation(stackId, 2);
    await seedAllocation(stackId, 1);

    const results = await suggest("Lightning", true);
    expect(results[0]?.owned).toBe(1);
    expect(results[0]?.free).toBe(0);
  });

  it("sums copies across two stacks of the same card", async () => {
    await seedCards();
    await seedStack(bolt, 1, "NM");
    await seedStack(bolt, 2, "MP");
    expect((await suggest("Lightning", true))[0]?.owned).toBe(3);
  });
});

describe("rankByAvailability", () => {
  it("puts cards with a free copy above fully claimed ones", async () => {
    const { rankByAvailability, toSuggestion } = await import("./card-search");
    const claimed = toSuggestion(buildCard(bolt, { name: "Claimed" }), 1, 0);
    const free = toSuggestion(buildCard(solRingA, { name: "Free" }), 1, 1);

    expect(rankByAvailability([claimed, free]).map((card) => card.name)).toEqual([
      "Free",
      "Claimed",
    ]);
  });

  it("preserves relevance order within each group", async () => {
    // A stable partition, not a re-sort. Throwing away FTS rank would answer
    // "what is free?" instead of "what am I looking for?".
    const { rankByAvailability, toSuggestion } = await import("./card-search");
    const a = toSuggestion(buildCard(bolt, { name: "A" }), 1, 1);
    const b = toSuggestion(buildCard(solRingA, { name: "B" }), 1, 1);
    const c = toSuggestion(buildCard(solRingB, { name: "C" }), 1, 0);
    const d = toSuggestion(buildCard(rift, { name: "D" }), 1, 0);

    expect(rankByAvailability([c, a, d, b]).map((card) => card.name)).toEqual(["A", "B", "C", "D"]);
  });
});
