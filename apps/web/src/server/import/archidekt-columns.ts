import { type Condition, deserializeTags } from "@mtg/schemas";

/**
 * Archidekt's own export and import CSV formats aren't fully documented
 * (checked archidekt.com's forums/dev-notes rather than assuming), and
 * third-party exports (Moxfield, ManaBox, etc.) that get run through this
 * importer will use different header names again - so headers are matched
 * by alias, case/whitespace-insensitively, rather than one hardcoded exact
 * header row. The one *confirmed* detail (Archidekt's own dev notes): a row
 * resolves via either a Scryfall ID alone, or name + set + collector number
 * together.
 */
// Defined as a const array (rather than a union type + `Object.keys(...) as
// CanonicalField[]`) so buildColumnMap can iterate the field list without a
// type assertion.
const CANONICAL_FIELDS = [
  "scryfallId",
  "name",
  "setCode",
  "setName",
  "collectorNumber",
  "quantity",
  "foil",
  "condition",
  "language",
  // Added by KAD-23. Without these three, this app's own CSV export would
  // silently drop the fields Sprint 4's other two stories just added -
  // which is exactly what "round-trip lossless" forbids. Third-party CSVs
  // that lack the columns keep working: the map is alias-based and every
  // field is already optional.
  "binderLocation",
  "isProxy",
  "tags",
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

const COLUMN_ALIASES: Record<CanonicalField, string[]> = {
  scryfallId: ["scryfall id", "scryfall_id", "scryfall uuid", "scryfall_uuid"],
  name: ["name", "card name", "card_name"],
  setCode: ["set code", "set_code", "edition code"],
  setName: ["set", "set name", "set_name", "edition"],
  collectorNumber: ["collector number", "collector_number", "card number", "number"],
  quantity: ["quantity", "qty", "count"],
  foil: ["foil", "finish", "foil_quantity", "variant"],
  condition: ["condition"],
  language: ["language", "lang"],
  binderLocation: ["binder location", "binder_location", "binder", "location", "storage"],
  isProxy: ["proxy", "is proxy", "is_proxy"],
  tags: ["tags", "tag"],
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Maps each recognized canonical field to the actual header text it matched, if any. */
export function buildColumnMap(headers: string[]): Partial<Record<CanonicalField, string>> {
  const normalized = headers.map((header) => ({ header, normalized: normalizeHeader(header) }));
  const map: Partial<Record<CanonicalField, string>> = {};
  for (const field of CANONICAL_FIELDS) {
    const match = normalized.find((h) => COLUMN_ALIASES[field].includes(h.normalized));
    if (match) map[field] = match.header;
  }
  return map;
}

export interface ParsedArchidektRow {
  scryfallId: string | null;
  name: string | null;
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
  quantity: number | null;
  foilRaw: string;
  conditionRaw: string;
  language: string | null;
  binderLocation: string;
  isProxy: boolean;
  tags: string[];
}

export function extractRow(
  rawRow: Record<string, string>,
  columnMap: Partial<Record<CanonicalField, string>>,
): ParsedArchidektRow {
  const get = (field: CanonicalField): string => {
    const header = columnMap[field];
    return header ? (rawRow[header] ?? "").trim() : "";
  };

  const quantityRaw = get("quantity");
  const quantityParsed = quantityRaw === "" ? Number.NaN : Number.parseInt(quantityRaw, 10);

  return {
    scryfallId: get("scryfallId") || null,
    name: get("name") || null,
    setCode: get("setCode") || null,
    setName: get("setName") || null,
    collectorNumber: get("collectorNumber") || null,
    quantity: Number.isFinite(quantityParsed) ? quantityParsed : null,
    foilRaw: get("foil"),
    conditionRaw: get("condition"),
    language: get("language") || null,
    // Absent column and empty cell both mean "unset", which is `""` - the
    // same value `collection_items` stores for it (see the table comment on
    // why that column is NOT NULL rather than nullable).
    binderLocation: get("binderLocation"),
    isProxy: parseBoolean(get("isProxy")),
    tags: deserializeTags(get("tags")),
  };
}

/**
 * Truthy spellings a CSV might plausibly use for a flag. Anything else -
 * including blank and an absent column - is false, matching how `foil` and
 * `condition` degrade rather than blocking a row over a cosmetic field.
 */
export function parseBoolean(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "y";
}

/**
 * Export uses TRUE/FALSE, import expects Normal/Foil (a known Archidekt
 * inconsistency per their own forum) - normalized to our Finish enum
 * regardless of which convention shows up. Unrecognized values default to
 * nonfoil rather than blocking printing resolution over a cosmetic field.
 */
export function parseFinish(raw: string): "nonfoil" | "foil" | "etched" {
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "foil") return "foil";
  if (value === "etched" || value === "foil etched") return "etched";
  return "nonfoil";
}

const CONDITION_ALIASES: Record<string, Condition> = {
  nm: "NM",
  "near mint": "NM",
  mint: "NM",
  lp: "LP",
  "lightly played": "LP",
  "light play": "LP",
  excellent: "LP",
  mp: "MP",
  "moderately played": "MP",
  played: "MP",
  good: "MP",
  hp: "HP",
  "heavily played": "HP",
  poor: "HP",
  dmg: "DMG",
  damaged: "DMG",
};

/** Unrecognized/blank condition defaults to NM - condition isn't part of printing resolution. */
export function parseCondition(raw: string): Condition {
  return CONDITION_ALIASES[raw.trim().toLowerCase()] ?? "NM";
}
