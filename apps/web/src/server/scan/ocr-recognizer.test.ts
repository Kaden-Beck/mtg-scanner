import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OcrEngine, RgbaImage } from "@mtg/scan-ocr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

const scryfallId = "0000419b-0bba-4488-8f7a-6194544ce91e";

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-ocr-recognizer-"));
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

function solidImage(): RgbaImage {
  const width = 100;
  const height = 140;
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(80);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width, height, data };
}

describe("createOcrRecognizer", () => {
  it("returns a T2 candidate when OCR parses a known printing", async () => {
    const { db } = await import("../db/client");
    const { cards } = await import("../db/schema");
    const now = new Date();
    await db.insert(cards).values({
      id: scryfallId,
      oracleId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
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
      finishes: ["nonfoil"],
      cardFaces: null,
      imageUris: null,
      scryfallUri: "https://scryfall.com/card/blb/280/forest",
      prices: {},
      createdAt: now,
      updatedAt: now,
    });

    const engine: OcrEngine = {
      recognize: () => Promise.resolve({ text: "BLB 280", confidence: 0.99 }),
    };
    const { createOcrRecognizer } = await import("./ocr-recognizer");
    const recognize = createOcrRecognizer({
      engine,
      loadImage: () => Promise.resolve(solidImage()),
    });
    const output = await recognize(join(dir, "unused.png"));
    expect(output.tier).toBe("T2");
    expect(output.candidates[0]?.scryfallId).toBe(scryfallId);
    expect(output.candidates[0]?.oracleId).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });

  it("returns no candidates when OCR cannot parse a set and number", async () => {
    const engine: OcrEngine = {
      recognize: () => Promise.resolve({ text: "???", confidence: null }),
    };
    const { createOcrRecognizer } = await import("./ocr-recognizer");
    const recognize = createOcrRecognizer({
      engine,
      loadImage: () => Promise.resolve(solidImage()),
    });
    const output = await recognize(join(dir, "unused.png"));
    expect(output).toEqual({ candidates: [], tier: "T2" });
  });
});
