import { describe, expect, it } from "vitest";
import { buildColumnMap, extractRow, parseCondition, parseFinish } from "./archidekt-columns";

describe("buildColumnMap", () => {
  it("matches known aliases case- and whitespace-insensitively", () => {
    const map = buildColumnMap(["Card Name", "Set Code", "Collector Number", "Qty", "Foil"]);
    expect(map).toEqual({
      name: "Card Name",
      setCode: "Set Code",
      collectorNumber: "Collector Number",
      quantity: "Qty",
      foil: "Foil",
    });
  });

  it("leaves unrecognized fields unmapped", () => {
    const map = buildColumnMap(["Name", "Some Random Column"]);
    expect(map.name).toBe("Name");
    expect(Object.keys(map)).not.toContain("someRandomColumn");
  });
});

describe("extractRow", () => {
  it("pulls values through the column map and parses quantity as an integer", () => {
    const columnMap = buildColumnMap(["Name", "Qty"]);
    const row = extractRow({ Name: "Forest", Qty: "4" }, columnMap);
    expect(row.name).toBe("Forest");
    expect(row.quantity).toBe(4);
  });

  it("returns null quantity for a missing or non-numeric value", () => {
    const columnMap = buildColumnMap(["Name", "Qty"]);
    expect(extractRow({ Name: "Forest", Qty: "" }, columnMap).quantity).toBeNull();
    expect(extractRow({ Name: "Forest", Qty: "abc" }, columnMap).quantity).toBeNull();
  });

  it("returns null for fields whose column wasn't found at all", () => {
    const columnMap = buildColumnMap(["Name"]);
    const row = extractRow({ Name: "Forest" }, columnMap);
    expect(row.setCode).toBeNull();
    expect(row.collectorNumber).toBeNull();
  });
});

describe("parseFinish", () => {
  it("recognizes both the export (TRUE/FALSE) and import (Normal/Foil) conventions", () => {
    expect(parseFinish("TRUE")).toBe("foil");
    expect(parseFinish("Foil")).toBe("foil");
    expect(parseFinish("FALSE")).toBe("nonfoil");
    expect(parseFinish("Normal")).toBe("nonfoil");
    expect(parseFinish("")).toBe("nonfoil");
  });

  it("recognizes etched", () => {
    expect(parseFinish("Etched")).toBe("etched");
  });
});

describe("parseCondition", () => {
  it("maps common condition spellings to the enum", () => {
    expect(parseCondition("Near Mint")).toBe("NM");
    expect(parseCondition("lp")).toBe("LP");
    expect(parseCondition("Heavily Played")).toBe("HP");
  });

  it("defaults to NM for blank or unrecognized values", () => {
    expect(parseCondition("")).toBe("NM");
    expect(parseCondition("Sparkly")).toBe("NM");
  });
});
