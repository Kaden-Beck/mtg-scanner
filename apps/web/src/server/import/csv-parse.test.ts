import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvRecords } from "./csv-parse";

describe("parseCsv", () => {
  it("parses a simple comma-separated file", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles a quoted field containing a comma", () => {
    expect(parseCsv('a,b\n"1, 2",3\n')).toEqual([
      ["a", "b"],
      ["1, 2", "3"],
    ]);
  });

  it("handles an escaped quote inside a quoted field", () => {
    expect(parseCsv('a\n"say ""hi"""\n')).toEqual([["a"], ['say "hi"']]);
  });

  it("handles a quoted field containing a newline", () => {
    expect(parseCsv('a\n"line1\nline2"\n')).toEqual([["a"], ["line1\nline2"]]);
  });

  it("normalizes CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("does not emit a phantom trailing row for a final newline", () => {
    expect(parseCsv("a,b\n1,2\n")).toHaveLength(2);
  });

  it("handles a file with no trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseCsvRecords", () => {
  it("keys each row by header", () => {
    const { headers, rows } = parseCsvRecords("Name,Quantity\nForest,4\nIsland,3\n");
    expect(headers).toEqual(["Name", "Quantity"]);
    expect(rows).toEqual([
      { Name: "Forest", Quantity: "4" },
      { Name: "Island", Quantity: "3" },
    ]);
  });

  it("skips fully blank lines", () => {
    const { rows } = parseCsvRecords("Name,Quantity\nForest,4\n\nIsland,3\n");
    expect(rows).toHaveLength(2);
  });

  it("returns empty headers/rows for empty input", () => {
    expect(parseCsvRecords("")).toEqual({ headers: [], rows: [] });
  });
});
