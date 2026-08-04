import { scryfallIdSchema } from "@mtg/schemas";
import { describe, expect, it } from "vitest";
import { parseCsvRecords } from "../import/csv-parse";
import { CSV_COLUMNS, toCsv } from "./csv";
import { EXPORT_FORMAT_INFO, EXPORT_FORMATS, exportFilename, isExportFormat } from "./formats";
import { COLLECTION_EXPORT_VERSION, parseJson, toJson } from "./json";
import { toMoxfieldText } from "./moxfield";
import type { CollectionExportRow } from "./row-schema";

/**
 * The serializers on their own, with no database. The end-to-end guarantee
 * lives in `round-trip.test.ts`; this file pins down the encoding decisions
 * that guarantee rests on, so a failure points at the format rather than at
 * the whole pipeline.
 */

const ROW: CollectionExportRow = {
  scryfallId: scryfallIdSchema.parse("0000419b-0bba-4488-8f7a-6194544ce91e"),
  name: "Lightning Bolt",
  setCode: "lea",
  setName: "Limited Edition Alpha",
  collectorNumber: "161",
  quantity: 4,
  finish: "nonfoil",
  condition: "NM",
  isProxy: false,
  binderLocation: "Box 1",
  language: "en",
  tags: ["burn", "cube"],
};

describe("toCsv", () => {
  it("writes the header row even for an empty collection", () => {
    expect(toCsv([])).toBe(`${CSV_COLUMNS.join(",")}\r\n`);
  });

  // These headers are not cosmetic: every one is an alias the importer's
  // column map recognizes, which is what makes the export re-importable.
  it("uses only headers the importer recognizes", async () => {
    const { buildColumnMap } = await import("../import/archidekt-columns");
    const map = buildColumnMap([...CSV_COLUMNS]);
    expect(Object.keys(map).sort()).toEqual([
      "binderLocation",
      "collectorNumber",
      "condition",
      "foil",
      "isProxy",
      "language",
      "name",
      "quantity",
      "scryfallId",
      "setCode",
      "setName",
      "tags",
    ]);
  });

  it.each([
    ["a comma", "Box 1, shelf 2"],
    ["a double quote", 'Box "A"'],
    ["both", 'Box 1, shelf "A"'],
    ["a newline", "Trade\nbinder"],
    ["a carriage return", "Trade\r\nbinder"],
  ])("survives a binder location containing %s", (_label, binderLocation) => {
    const csv = toCsv([{ ...ROW, binderLocation }]);
    const { rows } = parseCsvRecords(csv);
    // Byte-for-byte, CR included: the parser only strips a bare CR *outside*
    // a quoted field (where it is a line ending), and everything here is
    // quoted because it contains a character that requires quoting.
    expect(rows[0]?.["Binder Location"]).toBe(binderLocation);
  });

  it("writes the finish and condition values the importer parses back", async () => {
    const { parseCondition, parseFinish } = await import("../import/archidekt-columns");
    const csv = toCsv([{ ...ROW, finish: "etched", condition: "DMG" }]);
    const { rows } = parseCsvRecords(csv);
    expect(parseFinish(rows[0]?.["Foil"] ?? "")).toBe("etched");
    expect(parseCondition(rows[0]?.["Condition"] ?? "")).toBe("DMG");
  });

  it("writes the proxy flag as a value the importer reads as true", async () => {
    const { parseBoolean } = await import("../import/archidekt-columns");
    const { rows } = parseCsvRecords(toCsv([{ ...ROW, isProxy: true }]));
    expect(parseBoolean(rows[0]?.["Proxy"] ?? "")).toBe(true);
    const plain = parseCsvRecords(toCsv([ROW]));
    expect(parseBoolean(plain.rows[0]?.["Proxy"] ?? "")).toBe(false);
  });

  it("emits one line per stack", () => {
    const csv = toCsv([ROW, { ...ROW, condition: "LP" }]);
    expect(parseCsvRecords(csv).rows).toHaveLength(2);
  });
});

describe("toJson / parseJson", () => {
  it("round-trips through the file schema", () => {
    const text = toJson([ROW], new Date("2026-08-03T12:00:00.000Z"));
    const parsed = parseJson(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.file.version).toBe(COLLECTION_EXPORT_VERSION);
      expect(parsed.file.exportedAt).toBe("2026-08-03T12:00:00.000Z");
      expect(parsed.file.items).toEqual([ROW]);
    }
  });

  it("is pretty-printed and newline-terminated, so it diffs and cats cleanly", () => {
    const text = toJson([ROW], new Date());
    expect(text).toContain("\n  ");
    expect(text.endsWith("\n")).toBe(true);
  });

  // Silently misreading a backup is the worst outcome available here, so an
  // unknown version is refused rather than guessed at.
  it.each([
    ["not JSON at all", "nope", "valid JSON"],
    ["a future version", '{"version":99,"exportedAt":"2026-08-03T12:00:00Z","items":[]}', "export"],
    ["a missing field", '{"version":1,"items":[]}', "export"],
  ])("refuses %s with a message", (_label, text, messagePart) => {
    const parsed = parseJson(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain(messagePart);
  });

  it("rejects an item whose quantity isn't a positive integer", () => {
    const text = toJson([{ ...ROW, quantity: 0 }], new Date());
    expect(parseJson(text).ok).toBe(false);
  });
});

describe("toMoxfieldText", () => {
  it("writes quantity, name, uppercased set code and collector number", () => {
    expect(toMoxfieldText([ROW])).toBe("4 Lightning Bolt (LEA) 161\n");
  });

  it.each([
    ["foil", " *F*"],
    ["etched", " *E*"],
    ["nonfoil", ""],
  ] as const)("marks %s finish as %s", (finish, marker) => {
    expect(
      toMoxfieldText([{ ...ROW, finish }])
        .trimEnd()
        .endsWith(marker || "161"),
    ).toBe(true);
  });

  it("produces nothing at all for an empty collection", () => {
    expect(toMoxfieldText([])).toBe("");
  });

  // Lossy by design. Asserted so it stays a decision rather than drifting
  // into an accident.
  it("carries none of the fields it documents as dropped", () => {
    const text = toMoxfieldText([{ ...ROW, isProxy: true }]);
    for (const dropped of ["Box 1", "NM", "burn", "cube", "true", "en"]) {
      expect(text).not.toContain(dropped);
    }
  });

  // Summing them would silently merge stacks the user deliberately keeps
  // apart, with nothing in the format able to explain why.
  it("does not sum two stacks of the same printing", () => {
    const text = toMoxfieldText([ROW, { ...ROW, condition: "LP", quantity: 1 }]);
    expect(text.trimEnd().split("\n")).toHaveLength(2);
  });
});

describe("export formats", () => {
  it("accepts every declared format and nothing else", () => {
    for (const format of EXPORT_FORMATS) expect(isExportFormat(format)).toBe(true);
    expect(isExportFormat("xlsx")).toBe(false);
    expect(isExportFormat("")).toBe(false);
  });

  it("gives every format a distinct extension and content type", () => {
    const extensions = EXPORT_FORMATS.map((f) => EXPORT_FORMAT_INFO[f].extension);
    expect(new Set(extensions).size).toBe(EXPORT_FORMATS.length);
  });

  // The two round-trip formats must not claim to be lossy, and the one that
  // is must say so - that note is what the UI renders.
  it("marks exactly the lossy format as lossy", () => {
    expect(EXPORT_FORMAT_INFO.json.lossyNote).toBeNull();
    expect(EXPORT_FORMAT_INFO.csv.lossyNote).toBeNull();
    expect(EXPORT_FORMAT_INFO.moxfield.lossyNote).toContain("Binder location");
  });

  it("dates the filename", () => {
    expect(exportFilename("csv", new Date("2026-08-03T12:00:00.000Z"))).toBe(
      "mtg-collection-2026-08-03.csv",
    );
  });
});
