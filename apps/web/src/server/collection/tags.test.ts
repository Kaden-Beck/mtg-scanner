import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scryfallIdSchema } from "@mtg/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

const scryfallId = scryfallIdSchema.parse("0000419b-0bba-4488-8f7a-6194544ce91e");

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-tags-unit-test-"));
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

async function seedCard() {
  const { db } = await import("../db/client");
  const { cards } = await import("../db/schema");
  const now = new Date();
  await db.insert(cards).values({
    id: scryfallId,
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

async function seedStack(binderLocation = "") {
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

describe("addTag", () => {
  it("adds a tag in its normalized form", async () => {
    await seedCard();
    const stack = await seedStack();
    const { addTag, listTagsForItem } = await import("./tags");

    expect(addTag(stack.id, "  Cube ")).toEqual({ outcome: "added", tag: "cube" });
    expect(listTagsForItem(stack.id)).toEqual(["cube"]);
  });

  // Normalization is what makes this one tag rather than two rows that look
  // identical in the UI and never match each other in a query.
  it("treats differently-cased spellings as the same tag", async () => {
    await seedCard();
    const stack = await seedStack();
    const { addTag, listTagsForItem } = await import("./tags");

    addTag(stack.id, "Cube");
    expect(addTag(stack.id, "CUBE")).toEqual({ outcome: "already_present", tag: "cube" });
    expect(listTagsForItem(stack.id)).toEqual(["cube"]);
  });

  it("rejects a tag that normalizes to nothing", async () => {
    await seedCard();
    const stack = await seedStack();
    const { addTag, listTagsForItem } = await import("./tags");

    expect(addTag(stack.id, "   ")).toEqual({ outcome: "invalid" });
    expect(listTagsForItem(stack.id)).toEqual([]);
  });

  // Checked explicitly rather than letting the foreign key throw: a raw
  // `FOREIGN KEY constraint failed` at the catch site is indistinguishable
  // from a real bug.
  it("reports an unknown stack instead of throwing a constraint error", async () => {
    const { addTag } = await import("./tags");
    expect(addTag("nope", "cube")).toEqual({ outcome: "not_found" });
  });

  it("keeps several distinct tags on one stack, alphabetically", async () => {
    await seedCard();
    const stack = await seedStack();
    const { addTag, listTagsForItem } = await import("./tags");

    for (const tag of ["cube", "burn", "trade"]) addTag(stack.id, tag);
    expect(listTagsForItem(stack.id)).toEqual(["burn", "cube", "trade"]);
  });
});

describe("removeTag", () => {
  it("removes a tag and reports that it did", async () => {
    await seedCard();
    const stack = await seedStack();
    const { addTag, listTagsForItem, removeTag } = await import("./tags");

    addTag(stack.id, "cube");
    expect(removeTag(stack.id, "cube")).toBe(true);
    expect(listTagsForItem(stack.id)).toEqual([]);
  });

  // The tag arrives from a form field and may be stale by the time it is
  // submitted, so "wasn't there" has to be distinguishable from "removed".
  it("reports false when the tag was not there", async () => {
    await seedCard();
    const stack = await seedStack();
    const { removeTag } = await import("./tags");
    expect(removeTag(stack.id, "cube")).toBe(false);
  });

  it("normalizes before removing, so any spelling works", async () => {
    await seedCard();
    const stack = await seedStack();
    const { addTag, removeTag } = await import("./tags");

    addTag(stack.id, "edh staple");
    expect(removeTag(stack.id, "  EDH   STAPLE  ")).toBe(true);
  });

  it("only removes the tag from the stack named", async () => {
    await seedCard();
    const first = await seedStack("box1");
    const second = await seedStack("box2");
    const { addTag, listTagsForItem, removeTag } = await import("./tags");

    addTag(first.id, "cube");
    addTag(second.id, "cube");
    removeTag(first.id, "cube");

    expect(listTagsForItem(first.id)).toEqual([]);
    expect(listTagsForItem(second.id)).toEqual(["cube"]);
  });
});

describe("tag cascade on stack delete", () => {
  // ON DELETE CASCADE only fires because db/client.ts sets `PRAGMA
  // foreign_keys = ON` - SQLite ignores foreign keys entirely by default,
  // so this asserts the pragma as much as the schema.
  it("deletes a stack's tags with the stack", async () => {
    await seedCard();
    const doomed = await seedStack("box1");
    const survivor = await seedStack("box2");
    const { addTag } = await import("./tags");
    addTag(doomed.id, "cube");
    addTag(survivor.id, "cube");

    const { deleteCollectionItem } = await import("./items");
    expect(deleteCollectionItem(doomed.id)).toBe(true);

    const { db } = await import("../db/client");
    const { collectionItemTags } = await import("../db/schema");
    const remaining = db.select().from(collectionItemTags).all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.collectionItemId).toBe(survivor.id);
  });
});

describe("listTagsForItems", () => {
  it("returns an empty map for no ids, without querying", async () => {
    const { listTagsForItems } = await import("./tags");
    expect(listTagsForItems([]).size).toBe(0);
  });

  it("groups tags by stack and omits stacks that have none", async () => {
    await seedCard();
    const tagged = await seedStack("box1");
    const untagged = await seedStack("box2");
    const { addTag, listTagsForItems } = await import("./tags");
    addTag(tagged.id, "cube");
    addTag(tagged.id, "burn");

    const byItem = listTagsForItems([tagged.id, untagged.id]);
    expect(byItem.get(tagged.id)).toEqual(["burn", "cube"]);
    expect(byItem.get(untagged.id)).toBeUndefined();
  });
});

describe("listTags", () => {
  it("counts the stacks carrying each tag, alphabetically", async () => {
    await seedCard();
    const first = await seedStack("box1");
    const second = await seedStack("box2");
    const { addTag, listTags } = await import("./tags");
    addTag(first.id, "cube");
    addTag(second.id, "cube");
    addTag(first.id, "burn");

    expect(listTags()).toEqual([
      { tag: "burn", stackCount: 1 },
      { tag: "cube", stackCount: 2 },
    ]);
  });

  it("caps how many tags it returns", async () => {
    await seedCard();
    const stack = await seedStack();
    const { addTag, listTags } = await import("./tags");
    for (const tag of ["a", "b", "c"]) addTag(stack.id, tag);

    expect(listTags(2)).toHaveLength(2);
  });
});
