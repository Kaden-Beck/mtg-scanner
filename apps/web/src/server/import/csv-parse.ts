/**
 * Minimal RFC4180 CSV parser: quoted fields, embedded commas/newlines
 * inside quotes, `""` as an escaped quote, bare CR stripped (normalizes
 * CRLF and lone CR line endings to LF). Hand-rolled rather than a
 * dependency - the algorithm is small and well-understood, and this only
 * needs to handle collection-export CSVs, not arbitrary spreadsheet input.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    // .charAt() always returns a string (empty past the end), sidestepping
    // noUncheckedIndexedAccess on `text[i]` - simpler than proving `i < n`
    // to the type checker at every access.
    const ch = text.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Only flush a trailing partial row - avoids a phantom empty row when the
  // file ends with a newline (the common case).
  if (field.length > 0 || row.length > 0) {
    endRow();
  }
  return rows;
}

export interface CsvRecords {
  headers: string[];
  rows: Record<string, string>[];
}

/** Parses into header-keyed records, skipping fully-blank lines. */
export function parseCsvRecords(text: string): CsvRecords {
  const table = parseCsv(text);
  if (table.length === 0) return { headers: [], rows: [] };

  const [headerRow, ...dataRows] = table;
  const headers = (headerRow ?? []).map((h) => h.trim());
  const rows = dataRows
    .filter((r) => !(r.length === 1 && r[0] === ""))
    .map((r) => Object.fromEntries(headers.map((h, idx) => [h, (r[idx] ?? "").trim()])));
  return { headers, rows };
}
