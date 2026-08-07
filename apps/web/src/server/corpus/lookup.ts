import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { type CardRow, cards } from "../db/schema.ts";

/**
 * Card resolution for the corpus labeller (KAD-36).
 *
 * Offline: every lookup is against the local `cards` table, which the KAD-8
 * ingest already filled with ~104.7k printings. Labelling 400 photographs
 * should not depend on Scryfall being reachable, and more importantly should
 * not be rate-limited into a multi-hour job.
 */

export interface ResolvedCard {
  card: CardRow;
  /**
   * True when more than one printing shares this card's `illustration_id`.
   *
   * Computed rather than asked. It is the single field most likely to be got
   * wrong by hand and the one that matters most - pHash cannot separate two
   * printings that share an illustration, so this flag is what tells the
   * harness which failures are expected and which are real.
   */
  sharedArt: boolean;
}

/**
 * Collector numbers are text ("168a", "★12"), but printed/OCR forms often
 * disagree with Scryfall's stored form: many sets print zero-padded numbers
 * ("041") while the bulk data stores "41". Try the obvious padding variants
 * after an exact miss — never invent letter suffixes.
 */
export function collectorNumberVariants(collectorNumber: string): string[] {
  const lower = collectorNumber.toLowerCase();
  const out: string[] = [lower];

  const stripped = lower.replace(/^0+(?=[0-9])/u, "");
  if (stripped !== lower) out.push(stripped);

  const core = /^(\d+)([a-z★†]?)$/u.exec(stripped);
  if (core?.[1] !== undefined) {
    const digits = core[1];
    const suffix = core[2] ?? "";
    for (const len of [3, 4] as const) {
      if (digits.length < len) out.push(`${digits.padStart(len, "0")}${suffix}`);
    }
  }

  return [...new Set(out)];
}

/**
 * OCR commonly confuses O/0 in set codes ("S0S" for SOS). Only applied as a
 * fallback after the literal miss.
 */
export function setCodeVariants(setCode: string): string[] {
  const lower = setCode.toLowerCase();
  const out: string[] = [lower];
  if (lower.includes("0")) out.push(lower.replaceAll("0", "o"));
  if (/o/u.test(lower)) out.push(lower.replaceAll("o", "0"));
  return [...new Set(out)];
}

function queryPrinting(setCode: string, collectorNumber: string): CardRow | undefined {
  return db
    .select()
    .from(cards)
    .where(
      and(
        eq(sql`lower(${cards.setCode})`, setCode),
        eq(sql`lower(${cards.collectorNumber})`, collectorNumber),
      ),
    )
    .get();
}

/**
 * Set code + collector number identifies exactly one printing.
 *
 * Both are compared case-insensitively on the *stored* value, because
 * SQLite's default `=` is BINARY (see CLAUDE.md) and set codes are stored
 * lowercase while people read them off a card in uppercase. After an exact
 * miss, padding and O/0 set-code variants are tried for OCR/print mismatch.
 */
export function findPrinting(setCode: string, collectorNumber: string): ResolvedCard | null {
  for (const set of setCodeVariants(setCode)) {
    for (const number of collectorNumberVariants(collectorNumber)) {
      const card = queryPrinting(set, number);
      if (card) return { card, sharedArt: hasSharedArt(card) };
    }
  }
  return null;
}

/** Other printings using the same illustration. */
export function hasSharedArt(card: CardRow): boolean {
  if (card.illustrationId === null) return false;
  const other = db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.illustrationId, card.illustrationId), ne(cards.id, card.id)))
    .get();
  return other !== undefined;
}

/**
 * Suggestions when a set/number lookup misses - almost always a mistyped set
 * code, so the useful reply is "which sets contain a card with this number"
 * rather than a bare "not found".
 */
export function suggestSets(collectorNumber: string, limit = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const number of collectorNumberVariants(collectorNumber)) {
    const rows = db
      .select({ setCode: cards.setCode, name: cards.name })
      .from(cards)
      .where(eq(sql`lower(${cards.collectorNumber})`, number))
      .limit(limit)
      .all();
    for (const row of rows) {
      const label = `${row.setCode} (${row.name})`;
      if (seen.has(label)) continue;
      seen.add(label);
      out.push(label);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Printings of a card by name, for when the collector number is unreadable
 *  - old frames do not print one at all. */
export function findByName(name: string, limit = 10): CardRow[] {
  return db
    .select()
    .from(cards)
    .where(eq(sql`lower(${cards.name})`, name.toLowerCase()))
    .limit(limit)
    .all();
}

/**
 * Name + set → printing when CN OCR fails. Exact case-insensitive name match
 * within the set; ambiguous (multiple printings of the same name in one set)
 * returns null so the UI can ask for a manual number.
 */
export function findPrintingByNameAndSet(name: string, setCode: string): ResolvedCard | null {
  const rows = db
    .select()
    .from(cards)
    .where(
      and(
        eq(sql`lower(${cards.setCode})`, setCode.toLowerCase()),
        eq(sql`lower(${cards.name})`, name.toLowerCase()),
      ),
    )
    .all();

  if (rows.length === 1 && rows[0]) {
    return { card: rows[0], sharedArt: hasSharedArt(rows[0]) };
  }
  return null;
}
