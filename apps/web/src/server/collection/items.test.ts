import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scryfallIdSchema } from "@mtg/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

const scryfallId = scryfallIdSchema.parse("0000419b-0bba-4488-8f7a-6194544ce91e");
const otherScryfallId = scryfallIdSchema.parse("11111111-1111-4111-8111-111111111111");

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-collection-items-unit-test-"));
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

async function seedCard(id: string, name = "Forest") {
  const { db } = await import("../db/client");
  const { cards } = await import("../db/schema");
  const now = new Date();
  await db.insert(cards).values({
    id,
    oracleId: null,
    name,
    layout: "normal",
    manaCost: "",
    cmc: 0,
    typeLine: "Basic Land — Forest",
    oracleText: null,
    colors: [],
    colorIdentity: ["G"],
    keywords: [],
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
    createdAt: now,
    updatedAt: now,
  });
}

describe("createOrMergeCollectionItem", () => {
  it("throws CardNotFoundError for an unknown scryfallId", async () => {
    const { createOrMergeCollectionItem, CardNotFoundError } = await import("./items");
    expect(() =>
      createOrMergeCollectionItem({
        scryfallId: otherScryfallId,
        finish: "nonfoil",
        condition: "NM",
        quantity: 1,
        isProxy: false,
        binderLocation: "",
        language: "en",
      }),
    ).toThrow(CardNotFoundError);
  });
});

describe("listCollectionItems", () => {
  it("returns everything with no filter, and only matches with a scryfallId filter", async () => {
    await seedCard(scryfallId, "Forest");
    await seedCard(otherScryfallId, "Island");
    const { createOrMergeCollectionItem, listCollectionItems } = await import("./items");

    for (const id of [scryfallId, otherScryfallId]) {
      createOrMergeCollectionItem({
        scryfallId: id,
        finish: "nonfoil",
        condition: "NM",
        quantity: 1,
        isProxy: false,
        binderLocation: "",
        language: "en",
      });
    }

    expect(listCollectionItems()).toHaveLength(2);

    const filtered = listCollectionItems({ scryfallId });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.scryfallId).toBe(scryfallId);
  });
});

describe("getCollectionItem", () => {
  it("returns undefined for an unknown id", async () => {
    const { getCollectionItem } = await import("./items");
    expect(getCollectionItem("nope")).toBeUndefined();
  });

  it("returns the row for a known id", async () => {
    await seedCard(scryfallId);
    const { createOrMergeCollectionItem, getCollectionItem } = await import("./items");
    const created = createOrMergeCollectionItem({
      scryfallId,
      finish: "nonfoil",
      condition: "NM",
      quantity: 1,
      isProxy: false,
      binderLocation: "",
      language: "en",
    });
    expect(getCollectionItem(created.id)?.id).toBe(created.id);
  });
});

/**
 * KAD-21 moves stacks between binder locations from the browse page.
 * `binderLocation` is part of the stack unique index, so a move is the one
 * edit that can collide with a stack the user never mentioned - these pin
 * down that the collision is reported and, crucially, that the row is left
 * exactly as it was.
 */
describe("updateCollectionItem (binder location)", () => {
  async function seedStack(binderLocation: string) {
    const { createOrMergeCollectionItem } = await import("./items");
    return createOrMergeCollectionItem({
      scryfallId,
      finish: "nonfoil",
      condition: "NM",
      quantity: 1,
      isProxy: false,
      binderLocation,
      language: "en",
    });
  }

  it("moves a stack to a new location", async () => {
    await seedCard(scryfallId);
    const { updateCollectionItem } = await import("./items");
    const stack = await seedStack("");

    const result = updateCollectionItem(stack.id, { binderLocation: "box1" });
    expect(result.outcome).toBe("updated");
    expect(result.outcome === "updated" && result.row.binderLocation).toBe("box1");
  });

  it("reports a conflict when an identical stack already sits there", async () => {
    await seedCard(scryfallId);
    const { updateCollectionItem } = await import("./items");
    const source = await seedStack("box1");
    await seedStack("box2");

    expect(updateCollectionItem(source.id, { binderLocation: "box2" })).toEqual({
      outcome: "conflict",
    });
  });

  it("leaves the row untouched after a conflict", async () => {
    await seedCard(scryfallId);
    const { getCollectionItem, updateCollectionItem } = await import("./items");
    const source = await seedStack("box1");
    await seedStack("box2");

    updateCollectionItem(source.id, { binderLocation: "box2" });

    const after = getCollectionItem(source.id);
    expect(after?.binderLocation).toBe("box1");
    expect(after?.quantity).toBe(1);
    // Both stacks survive: a conflict must not be a disguised merge.
    const { listCollectionItems } = await import("./items");
    expect(listCollectionItems()).toHaveLength(2);
  });

  // Two stacks differing only in condition are two rows by design (KAD-12),
  // so they can share a location without colliding.
  it("allows two stacks in one location when another identity column differs", async () => {
    await seedCard(scryfallId);
    const { createOrMergeCollectionItem, updateCollectionItem } = await import("./items");
    const nearMint = await seedStack("box1");
    const played = createOrMergeCollectionItem({
      scryfallId,
      finish: "nonfoil",
      condition: "LP",
      quantity: 1,
      isProxy: false,
      binderLocation: "",
      language: "en",
    });

    expect(updateCollectionItem(played.id, { binderLocation: "box1" }).outcome).toBe("updated");
    expect(nearMint.binderLocation).toBe("box1");
  });

  it("reports not_found for an unknown id", async () => {
    const { updateCollectionItem } = await import("./items");
    expect(updateCollectionItem("nope", { binderLocation: "box1" })).toEqual({
      outcome: "not_found",
    });
  });
});
