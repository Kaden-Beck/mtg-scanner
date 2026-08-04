import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Condition, type Finish, scryfallIdSchema } from "@mtg/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionExportRow } from "./row-schema";

/**
 * KAD-23's acceptance gate. Per the ticket, "the round-trip test is the
 * actual acceptance gate here" - so this seeds a collection with every
 * field populated, exports it, imports the export into a *fresh* database,
 * and asserts the rows come back deep-equal.
 *
 * A fresh database matters: `createOrMergeCollectionItem` adds to an
 * existing stack rather than replacing it, so importing into the source
 * database would double every quantity and prove nothing. "Lossless" is a
 * claim about an empty target.
 *
 * Two databases are alive at once here, which the module-level connection
 * cache on `globalThis` normally prevents. `withDatabase` below switches
 * between them by resetting the module registry, which is why every import
 * in this file is dynamic and inside a callback.
 */

let sourceDir: string;
let targetDir: string;

beforeEach(() => {
  sourceDir = mkdtempSync(join(tmpdir(), "mtg-export-source-"));
  targetDir = mkdtempSync(join(tmpdir(), "mtg-export-target-"));
  process.env["DRIZZLE_MIGRATIONS_FOLDER"] = join(import.meta.dirname, "../../../drizzle");
});

afterEach(() => {
  globalThis.__mtgSqlite?.close();
  globalThis.__mtgSqlite = undefined;
  globalThis.__mtgDb = undefined;
  rmSync(sourceDir, { recursive: true, force: true });
  rmSync(targetDir, { recursive: true, force: true });
  delete process.env["DATABASE_PATH"];
  delete process.env["DRIZZLE_MIGRATIONS_FOLDER"];
});

/**
 * Runs `body` against the database at `dir`, with a connection that is not
 * shared with any other call. Resetting the module registry *and* nulling
 * both globals is required - clearing only one leaves a stale connection
 * (see the note in CLAUDE.md).
 */
async function withDatabase<T>(dir: string, body: () => Promise<T>): Promise<T> {
  globalThis.__mtgSqlite?.close();
  globalThis.__mtgSqlite = undefined;
  globalThis.__mtgDb = undefined;
  vi.resetModules();
  process.env["DATABASE_PATH"] = join(dir, "test.db");
  return body();
}

interface Printing {
  readonly id: string;
  readonly name: string;
  readonly setCode: string;
  readonly setName: string;
  readonly collectorNumber: string;
}

const BOLT: Printing = {
  id: "0000419b-0bba-4488-8f7a-6194544ce91e",
  name: "Lightning Bolt",
  setCode: "lea",
  setName: "Limited Edition Alpha",
  collectorNumber: "161",
};

const KROXA: Printing = {
  id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  // A name with a comma and an apostrophe: both are ordinary in card names,
  // and the comma is the one that reshapes a CSV if quoting is wrong.
  name: "Kroxa, Titan of Death's Hunger",
  setCode: "thb",
  setName: "Theros Beyond Death",
  collectorNumber: "221",
};

const VIAL: Printing = {
  // Non-ASCII name: the export declares a charset, and this is what proves
  // it survives rather than arriving as mojibake.
  id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
  name: "Æther Vial",
  setCode: "dst",
  setName: "Darksteel",
  collectorNumber: "91",
};

const PRINTINGS: readonly Printing[] = [BOLT, KROXA, VIAL];

interface StackSeed {
  readonly printing: Printing;
  readonly quantity: number;
  readonly finish: Finish;
  readonly condition: Condition;
  readonly isProxy: boolean;
  readonly binderLocation: string;
  readonly language: string;
  readonly tags: readonly string[];
}

/**
 * Every field populated, and every field populated with the value most
 * likely to break a serializer rather than a comfortable one.
 */
const STACKS: readonly StackSeed[] = [
  {
    printing: BOLT,
    quantity: 4,
    finish: "nonfoil",
    condition: "NM",
    isProxy: false,
    // A comma *and* a double quote in one binder location - the case the
    // plan flagged as most likely to break and least likely to be covered
    // by a hand-written fixture.
    binderLocation: 'Box 1, shelf "A"',
    language: "en",
    tags: ["burn", "cube"],
  },
  {
    printing: BOLT,
    // Same printing, different condition and finish: two stacks by design
    // (KAD-12), so the export must not collapse them into one.
    quantity: 1,
    finish: "foil",
    condition: "HP",
    isProxy: true,
    binderLocation: "",
    language: "ja",
    tags: [],
  },
  {
    printing: KROXA,
    quantity: 2,
    finish: "etched",
    condition: "LP",
    isProxy: false,
    binderLocation: "Deck: Kroxa",
    language: "de",
    // A tag containing the CSV tag-list separator, plus one containing a
    // backslash: without escaping these come back as four tags, or three
    // wrong ones.
    tags: ["a;b", "back\\slash", "edh staple"],
  },
  {
    printing: VIAL,
    quantity: 3,
    finish: "nonfoil",
    condition: "MP",
    isProxy: false,
    // Newline inside a field: legal CSV, and the thing a naive
    // line-splitting parser gets wrong.
    binderLocation: "Trade\nbinder",
    language: "en",
    tags: ["trade"],
  },
];

async function seedPrintings(): Promise<void> {
  const { db } = await import("../db/client");
  const { cards } = await import("../db/schema");
  const now = new Date();
  for (const printing of PRINTINGS) {
    await db.insert(cards).values({
      id: printing.id,
      oracleId: null,
      name: printing.name,
      layout: "normal",
      manaCost: "{R}",
      cmc: 1,
      typeLine: "Instant",
      oracleText: null,
      colors: ["R"],
      colorIdentity: ["R"],
      keywords: [],
      legalities: {},
      games: ["paper"],
      reserved: false,
      setCode: printing.setCode,
      setName: printing.setName,
      setType: "expansion",
      collectorNumber: printing.collectorNumber,
      rarity: "common",
      releasedAt: "1993-08-05",
      artist: "Test Artist",
      borderColor: "black",
      frame: "1993",
      fullArt: false,
      textless: false,
      promo: false,
      variation: false,
      finishes: ["nonfoil", "foil", "etched"],
      cardFaces: null,
      imageUris: null,
      scryfallUri: `https://scryfall.com/card/${printing.id}`,
      prices: {},
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function seedSourceCollection(): Promise<void> {
  await seedPrintings();
  const { createOrMergeCollectionItem } = await import("../collection/items");
  const { addTag } = await import("../collection/tags");

  for (const stack of STACKS) {
    const item = createOrMergeCollectionItem({
      scryfallId: scryfallIdSchema.parse(stack.printing.id),
      finish: stack.finish,
      condition: stack.condition,
      quantity: stack.quantity,
      isProxy: stack.isProxy,
      binderLocation: stack.binderLocation,
      language: stack.language,
    });
    for (const tag of stack.tags) addTag(item.id, tag);
  }
}

/** Seeds the source DB and returns both its export rows and the CSV/JSON text. */
async function exportSource(): Promise<{
  rows: CollectionExportRow[];
  json: string;
  csv: string;
  moxfield: string;
}> {
  return withDatabase(sourceDir, async () => {
    await seedSourceCollection();
    const { gatherExportRows } = await import("./rows");
    const { toJson } = await import("./json");
    const { toCsv } = await import("./csv");
    const { toMoxfieldText } = await import("./moxfield");

    const rows = gatherExportRows();
    return {
      rows,
      json: toJson(rows, new Date("2026-08-03T12:00:00.000Z")),
      csv: toCsv(rows),
      moxfield: toMoxfieldText(rows),
    };
  });
}

/** Imports into a fresh DB and returns what that DB would itself export. */
async function reimport(body: (text: string) => Promise<void>, text: string) {
  return withDatabase(targetDir, async () => {
    await seedPrintings();
    await body(text);
    const { gatherExportRows } = await import("./rows");
    return gatherExportRows();
  });
}

describe("export round trip (KAD-23 AC2)", () => {
  it("captures every seeded stack, without collapsing stacks of one printing", async () => {
    const { rows } = await exportSource();
    expect(rows).toHaveLength(STACKS.length);
    expect(rows.filter((row) => row.name === "Lightning Bolt")).toHaveLength(2);
  });

  it("JSON round-trips losslessly", async () => {
    const { rows, json } = await exportSource();
    const roundTripped = await reimport(async (text) => {
      const { importCollectionJson } = await import("../import/collection-json");
      const result = importCollectionJson(text);
      expect(result).toMatchObject({ outcome: "completed", imported: STACKS.length, skipped: [] });
    }, json);

    expect(roundTripped).toEqual(rows);
  });

  it("CSV round-trips losslessly", async () => {
    const { rows, csv } = await exportSource();
    const roundTripped = await reimport(async (text) => {
      const { importArchidektCsv } = await import("../import/archidekt");
      const result = importArchidektCsv({ fileName: "round-trip.csv", csvText: text });
      expect(result.outcome).toBe("completed");
      if (result.outcome === "completed") {
        expect(result.batch.resolvedRows).toBe(STACKS.length);
        expect(result.batch.unresolvedRows).toBe(0);
      }
    }, csv);

    expect(roundTripped).toEqual(rows);
  });

  // Exporting twice over unchanged data must give identical bytes, or
  // diffing two exports - the obvious thing to do with them - is useless.
  it("is byte-stable across runs", async () => {
    const first = await exportSource();
    const second = await withDatabase(sourceDir, async () => {
      const { gatherExportRows } = await import("./rows");
      const { toCsv } = await import("./csv");
      return toCsv(gatherExportRows());
    });
    expect(second).toBe(first.csv);
  });

  it("exports an empty collection without producing a bogus row", async () => {
    const empty = await withDatabase(targetDir, async () => {
      const { gatherExportRows } = await import("./rows");
      const { toCsv } = await import("./csv");
      const { toMoxfieldText } = await import("./moxfield");
      const rows = gatherExportRows();
      return { rows, csv: toCsv(rows), moxfield: toMoxfieldText(rows) };
    });
    expect(empty.rows).toEqual([]);
    // Header only, and no trailing blank line for Moxfield.
    expect(empty.csv.trimEnd().split("\r\n")).toHaveLength(1);
    expect(empty.moxfield).toBe("");
  });

  // Lossy by design (AC1 still requires the format; AC2's gate is scoped to
  // JSON and CSV). Asserted so the limitation stays deliberate.
  it("Moxfield text carries the deck-list fields and nothing else", async () => {
    const { moxfield } = await exportSource();
    const lines = moxfield.trimEnd().split("\n");
    expect(lines).toHaveLength(STACKS.length);
    expect(lines).toContain("4 Lightning Bolt (LEA) 161");
    expect(lines).toContain("1 Lightning Bolt (LEA) 161 *F*");
    expect(moxfield).not.toContain("Box 1");
    expect(moxfield).not.toContain("cube");
  });

  it("reports rows whose printing is unknown rather than dropping them", async () => {
    const { json } = await exportSource();
    const skipped = await withDatabase(targetDir, async () => {
      // Deliberately no printings seeded.
      const { importCollectionJson } = await import("../import/collection-json");
      return importCollectionJson(json);
    });
    expect(skipped).toMatchObject({ outcome: "completed", imported: 0 });
    if (skipped.outcome === "completed") {
      expect(skipped.skipped).toHaveLength(STACKS.length);
      expect(skipped.skipped[0]?.reason).toBe("printing_not_found");
    }
  });

  it("refuses a file that isn't one of our exports", async () => {
    const result = await withDatabase(targetDir, async () => {
      const { importCollectionJson } = await import("../import/collection-json");
      return importCollectionJson('{"version":99,"exportedAt":"x","items":[]}');
    });
    expect(result.outcome).toBe("invalid");
  });

  it("refuses text that isn't JSON at all", async () => {
    const result = await withDatabase(targetDir, async () => {
      const { importCollectionJson } = await import("../import/collection-json");
      return importCollectionJson("Scryfall ID,Quantity\n");
    });
    expect(result).toMatchObject({ outcome: "invalid" });
    if (result.outcome === "invalid") expect(result.message).toContain("valid JSON");
  });
});
