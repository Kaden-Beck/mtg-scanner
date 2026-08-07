import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scryfallIdSchema } from "@mtg/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCard } from "../decks/test-cards";

/**
 * Card resolution for the corpus labeller (KAD-36). Needs a real database -
 * the whole module is queries.
 */

let dir: string;

const elvesDom = scryfallIdSchema.parse("f47ac10b-58cc-4372-a567-0e02b2c3d479");
const solRingC19 = scryfallIdSchema.parse("6b3f2a4d-5c1e-4a8b-9d2f-7e0c3b5a1d84");
const solRingC21 = scryfallIdSchema.parse("2c9e7f14-8a3b-4d6e-b1f0-9c4a2e8d5b73");
const boltUnique = scryfallIdSchema.parse("9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d");

const SHARED_ILLUSTRATION = "3f8a1b2c-4d5e-4f60-8a1b-2c3d4e5f6a7b";

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-corpus-lookup-"));
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
      buildCard(elvesDom, {
        name: "Llanowar Elves",
        setCode: "dom",
        collectorNumber: "168",
        illustrationId: "aaaa1111-2222-4333-8444-555566667777",
      }),
      // Two printings sharing one illustration.
      buildCard(solRingC19, {
        name: "Sol Ring",
        setCode: "c19",
        collectorNumber: "241",
        illustrationId: SHARED_ILLUSTRATION,
      }),
      buildCard(solRingC21, {
        name: "Sol Ring",
        setCode: "c21",
        collectorNumber: "268",
        illustrationId: SHARED_ILLUSTRATION,
      }),
      buildCard(boltUnique, {
        name: "Lightning Bolt",
        setCode: "lea",
        collectorNumber: "161",
        illustrationId: null,
      }),
    ])
    .run();
}

describe("findPrinting", () => {
  it("resolves a set code and collector number to one printing", async () => {
    await seed();
    const { findPrinting } = await import("./lookup");
    expect(findPrinting("dom", "168")?.card.id).toBe(elvesDom);
  });

  it("is case-insensitive on the set code", async () => {
    // SQLite's default `=` is BINARY (see CLAUDE.md), and people read set
    // codes off a card in uppercase while they are stored lowercase.
    await seed();
    const { findPrinting } = await import("./lookup");
    expect(findPrinting("DOM", "168")?.card.id).toBe(elvesDom);
    expect(findPrinting("Dom", "168")?.card.id).toBe(elvesDom);
  });

  it("is null for a set that has no such number", async () => {
    await seed();
    const { findPrinting } = await import("./lookup");
    expect(findPrinting("dom", "9999")).toBeNull();
  });

  it("matches zero-padded OCR forms to the stored collector number", async () => {
    // Cards often print "0168"; Scryfall/bulk store "168". Letter suffixes
    // stay exact — "168a" is a different printing, not a pad of "168".
    await seed();
    const { findPrinting } = await import("./lookup");
    expect(findPrinting("dom", "0168")?.card.id).toBe(elvesDom);
    expect(findPrinting("dom", "168a")).toBeNull();
  });

  it("retries O/0 confusions in the set code", async () => {
    await seed();
    const { findPrinting } = await import("./lookup");
    expect(findPrinting("d0m", "168")?.card.id).toBe(elvesDom);
  });

  it("flags a printing whose art is shared with another", async () => {
    await seed();
    const { findPrinting } = await import("./lookup");
    expect(findPrinting("c19", "241")?.sharedArt).toBe(true);
    expect(findPrinting("c21", "268")?.sharedArt).toBe(true);
  });

  it("does not flag a printing whose art is unique", async () => {
    await seed();
    const { findPrinting } = await import("./lookup");
    expect(findPrinting("dom", "168")?.sharedArt).toBe(false);
  });

  it("does not flag a card with no illustration id as shared", async () => {
    // Two nulls are not "the same artwork" - that would mark every
    // illustration-less card as the hard case and poison the stratum.
    await seed();
    const { findPrinting } = await import("./lookup");
    expect(findPrinting("lea", "161")?.sharedArt).toBe(false);
  });
});

describe("suggestSets", () => {
  it("names the sets containing a given collector number", async () => {
    // The common failure is a mistyped set code, so "which sets have a #241"
    // is more useful than a bare not-found.
    await seed();
    const { suggestSets } = await import("./lookup");
    const suggestions = await Promise.resolve(suggestSets("241"));
    expect(suggestions.join(" ")).toContain("c19");
    expect(suggestions.join(" ")).toContain("Sol Ring");
  });

  it("is empty when no set has that number", async () => {
    await seed();
    const { suggestSets } = await import("./lookup");
    expect(suggestSets("99999")).toEqual([]);
  });
});

describe("findByName", () => {
  it("lists every printing of a card, for when the number is unreadable", async () => {
    // Old frames print no collector number at all.
    await seed();
    const { findByName } = await import("./lookup");
    expect(
      findByName("Sol Ring")
        .map((card) => card.setCode)
        .sort(),
    ).toEqual(["c19", "c21"]);
  });

  it("is case-insensitive", async () => {
    await seed();
    const { findByName } = await import("./lookup");
    expect(findByName("sol ring")).toHaveLength(2);
  });
});

describe("findPrintingByNameAndSet", () => {
  it("resolves when the name is unique in the set", async () => {
    await seed();
    const { findPrintingByNameAndSet } = await import("./lookup");
    expect(findPrintingByNameAndSet("Llanowar Elves", "dom")?.card.id).toBe(elvesDom);
  });

  it("is null when the name is ambiguous in the set", async () => {
    // Two Sol Rings in different sets still unique per set — seed a duplicate name in dom.
    await seed();
    const { db } = await import("../db/client");
    const { cards } = await import("../db/schema");
    const { buildCard } = await import("../decks/test-cards");
    const dup = scryfallIdSchema.parse("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    db.insert(cards)
      .values(
        buildCard(dup, {
          name: "Llanowar Elves",
          setCode: "dom",
          collectorNumber: "999",
          illustrationId: null,
        }),
      )
      .run();
    const { findPrintingByNameAndSet } = await import("./lookup");
    expect(findPrintingByNameAndSet("Llanowar Elves", "dom")).toBeNull();
  });
});
