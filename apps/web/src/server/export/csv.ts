import { serializeTags } from "@mtg/schemas";
import type { CollectionExportRow } from "./row-schema";

/**
 * Header text for each exported column.
 *
 * These are not arbitrary labels: every one of them is an alias the
 * importer's column map already recognizes (`archidekt-columns.ts`), which
 * is what makes the CSV round-trip rather than merely look right. Changing
 * one here without adding it there silently breaks re-import - the exact
 * failure mode AC2 exists to catch.
 */
export const CSV_COLUMNS = [
  "Scryfall ID",
  "Name",
  "Set Code",
  "Set",
  "Collector Number",
  "Quantity",
  "Foil",
  "Condition",
  "Language",
  "Binder Location",
  "Proxy",
  "Tags",
] as const;

/**
 * Quotes a field if it contains anything that would otherwise change the
 * shape of the file, doubling embedded quotes per RFC4180. A binder
 * location containing a comma or a quote is the case most likely to break
 * an export and least likely to appear in a hand-written fixture, so it is
 * covered explicitly in the round-trip test.
 */
function escapeCsvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function toCsvRow(values: readonly string[]): string {
  return values.map(escapeCsvField).join(",");
}

/**
 * CSV export (KAD-23 AC1). Lossless, because the importer was taught
 * `binderLocation`, `isProxy` and tags in the same story - without that
 * this format would silently drop the three fields Sprint 4's other
 * stories just added.
 *
 * `finish` and `condition` are written as their canonical stored values
 * rather than Archidekt's TRUE/FALSE convention: `parseFinish` and
 * `parseCondition` accept both, and writing what we store means the file
 * says what it means.
 */
export function toCsv(rows: readonly CollectionExportRow[]): string {
  const lines = [toCsvRow(CSV_COLUMNS)];
  for (const row of rows) {
    lines.push(
      toCsvRow([
        row.scryfallId,
        row.name,
        row.setCode,
        row.setName,
        row.collectorNumber,
        String(row.quantity),
        row.finish,
        row.condition,
        row.language,
        row.binderLocation,
        row.isProxy ? "true" : "false",
        serializeTags(row.tags),
      ]),
    );
  }
  // CRLF: RFC4180 says so, and it is what spreadsheet software expects. The
  // parser normalizes both endings on the way back in.
  return `${lines.join("\r\n")}\r\n`;
}
