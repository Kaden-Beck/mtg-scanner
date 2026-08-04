import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Condition, type Finish, scryfallIdSchema } from "@mtg/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCard } from "./test-cards";

/**
 * The DB half of KAD-32. Separate file from `ownership.test.ts` because the
 * rules are pure and this needs a real SQLite instance - and because the
 * thing actually worth exercising here is the oracle-level join, which no
 * amount of pure testing reaches.
 */

let dir: string;

// Real crypto.randomUUID()-shaped values - `z.uuid()` enforces the version
// and variant nibbles (see CLAUDE.md).
const solRingC19 = scryfallIdSchema.parse("6b3f2a4d-5c1e-4a8b-9d2f-7e0c3b5a1d84");
const solRingKld = scryfallIdSchema.parse("2c9e7f14-8a3b-4d6e-b1f0-9c4a2e8d5b73");
const elves = scryfallIdSchema.parse("f47ac10b-58cc-4372-a567-0e02b2c3d479");
const cyclonicRift = scryfallIdSchema.parse("9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d");

const SOL_RING_ORACLE = "0d1b1cb6-e5a1-4b6f-9a0d-2f3c4b5a6d7e";
const ELVES_ORACLE = "1e2c3d4f-6b7a-4c8d-9e0f-3a4b5c6d7e8f";

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-ownership-test-"));
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
      buildCard(solRingC19, {
        name: "Sol Ring",
        oracleId: SOL_RING_ORACLE,
        setCode: "c19",
        prices: { usd: "1.50" },
      }),
      buildCard(solRingKld, {
        name: "Sol Ring",
        oracleId: SOL_RING_ORACLE,
        setCode: "kld",
        prices: { usd: "2.00" },
      }),
      buildCard(elves, { name: "Llanowar Elves", oracleId: ELVES_ORACLE, prices: { usd: "0.25" } }),
      // No oracle id at all - the conservative printing-only path.
      buildCard(cyclonicRift, { name: "Cyclonic Rift", oracleId: null, prices: { usd: "30.00" } }),
    ])
    .run();
}

let stackCounter = 0;

async function seedStack(
  scryfallId: string,
  quantity: number,
  overrides: {
    condition?: Condition;
    finish?: Finish;
    binderLocation?: string;
    isProxy?: boolean;
  } = {},
) {
  const { db } = await import("../db/client");
  const { collectionItems } = await import("../db/schema");
  stackCounter += 1;
  const now = new Date();
  db.insert(collectionItems)
    .values({
      id: `stack-${String(stackCounter)}`,
      scryfallId,
      finish: overrides.finish ?? "nonfoil",
      condition: overrides.condition ?? "NM",
      quantity,
      isProxy: overrides.isProxy ?? false,
      binderLocation: overrides.binderLocation ?? "",
      language: "en",
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

async function ownershipFor(
  entries: { id: string; scryfallId: string; quantity: number }[],
): Promise<Map<string, import("./ownership").EntryOwnership>> {
  const { db } = await import("../db/client");
  const { cards } = await import("../db/schema");
  const { loadDeckOwnership } = await import("./hydrate");
  const { eq } = await import("drizzle-orm");

  const items = entries.map((entry) => {
    const card = db.select().from(cards).where(eq(cards.id, entry.scryfallId)).get();
    if (!card) throw new Error(`missing fixture card ${entry.scryfallId}`);
    return { entry, card };
  });
  return loadDeckOwnership(items);
}

describe("loadDeckOwnership", () => {
  it("returns an empty map for a deck with no cards", async () => {
    await seedCards();
    expect((await ownershipFor([])).size).toBe(0);
  });

  it("marks a card with no collection stack as unowned", async () => {
    await seedCards();
    const result = await ownershipFor([{ id: "e1", scryfallId: elves, quantity: 1 }]);
    expect(result.get("e1")?.status).toBe("unowned");
  });

  it("matches the exact printing", async () => {
    await seedCards();
    await seedStack(elves, 1);
    const result = await ownershipFor([{ id: "e1", scryfallId: elves, quantity: 1 }]);
    expect(result.get("e1")?.status).toBe("owned");
    expect(result.get("e1")?.ownedExact).toBe(1);
  });

  it("matches a different printing of the same oracle card", async () => {
    // The load-bearing case: deck names the C19 Sol Ring, box holds the KLD
    // one. Printing-level matching would call this unowned.
    await seedCards();
    await seedStack(solRingKld, 1);

    const result = await ownershipFor([{ id: "e1", scryfallId: solRingC19, quantity: 1 }]);
    const entry = result.get("e1");
    expect(entry?.status).toBe("owned");
    expect(entry?.ownedExact).toBe(0);
    expect(entry?.ownedOtherPrinting).toBe(1);
    expect(entry?.stacks[0]?.exactPrinting).toBe(false);
  });

  it("counts both printings together and orders the exact one first", async () => {
    await seedCards();
    await seedStack(solRingKld, 1, { binderLocation: "Binder 1" });
    await seedStack(solRingC19, 2, { binderLocation: "Binder 4" });

    const entry = (await ownershipFor([{ id: "e1", scryfallId: solRingC19, quantity: 3 }])).get(
      "e1",
    );
    expect(entry?.owned).toBe(3);
    expect(entry?.status).toBe("owned");
    expect(entry?.stacks.map((s) => s.exactPrinting)).toEqual([true, false]);
  });

  it("does not leak one card's stacks into another entry", async () => {
    await seedCards();
    await seedStack(elves, 4);

    const result = await ownershipFor([
      { id: "e1", scryfallId: elves, quantity: 1 },
      { id: "e2", scryfallId: solRingC19, quantity: 1 },
    ]);
    expect(result.get("e1")?.status).toBe("owned");
    expect(result.get("e2")?.status).toBe("unowned");
  });

  it("matches on printing alone when the card has no oracle id", async () => {
    await seedCards();
    await seedStack(cyclonicRift, 1);
    const entry = (await ownershipFor([{ id: "e1", scryfallId: cyclonicRift, quantity: 1 }])).get(
      "e1",
    );
    expect(entry?.status).toBe("owned");
    expect(entry?.ownedExact).toBe(1);
  });

  it("carries binder location, condition and proxy flag through to the stack", async () => {
    // KAD-21 AC2, descoped from Sprint 4 because no decks existed then.
    await seedCards();
    await seedStack(elves, 1, {
      binderLocation: "Green binder",
      condition: "LP",
      finish: "foil",
      isProxy: true,
    });

    const entry = (await ownershipFor([{ id: "e1", scryfallId: elves, quantity: 1 }])).get("e1");
    expect(entry?.stacks[0]).toMatchObject({
      binderLocation: "Green binder",
      condition: "LP",
      finish: "foil",
      isProxy: true,
    });
    expect(entry?.ownedProxy).toBe(1);
  });

  it("sums separate stacks of the same printing that differ in condition", async () => {
    await seedCards();
    await seedStack(elves, 1, { condition: "NM" });
    await seedStack(elves, 3, { condition: "MP" });

    const entry = (await ownershipFor([{ id: "e1", scryfallId: elves, quantity: 4 }])).get("e1");
    expect(entry?.owned).toBe(4);
    expect(entry?.status).toBe("owned");
  });

  it("is partial when the box holds fewer copies than the deck asks for", async () => {
    await seedCards();
    await seedStack(elves, 2);
    const entry = (await ownershipFor([{ id: "e1", scryfallId: elves, quantity: 4 }])).get("e1");
    expect(entry?.status).toBe("partial");
    expect(entry?.missing).toBe(2);
  });
});
