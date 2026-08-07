import { type ScanResolvedCard, scanResolvedCardSchema } from "@mtg/schemas";
import { findPrinting, findPrintingByNameAndSet, suggestSets } from "../corpus/lookup.ts";

export type ResolvePrintingResult =
  | { ok: true; card: ScanResolvedCard }
  | { ok: false; error: "not_found"; suggestions: string[] };

function toResolvedCard(resolved: {
  card: {
    id: string;
    oracleId: string | null;
    name: string;
    setCode: string;
    collectorNumber: string;
  };
  sharedArt: boolean;
}): ScanResolvedCard {
  return scanResolvedCardSchema.parse({
    scryfallId: resolved.card.id,
    oracleId: resolved.card.oracleId,
    name: resolved.card.name,
    setCode: resolved.card.setCode,
    collectorNumber: resolved.card.collectorNumber,
    sharedArt: resolved.sharedArt,
  });
}

/**
 * Exact set + collector-number → printing (KAD-44). Offline against the
 * local `cards` table — never hits Scryfall at scan time.
 *
 * Optional name+set path is the title-bar fallback when the modern two-line
 * CN strip confuses OCR (rarity / EN / artist on the same corner).
 */
export function resolvePrinting(
  setCode: string,
  collectorNumber?: string,
  name?: string,
): ResolvePrintingResult {
  if (collectorNumber) {
    const resolved = findPrinting(setCode, collectorNumber);
    if (resolved) {
      return { ok: true, card: toResolvedCard(resolved) };
    }
  }

  if (name) {
    const byName = findPrintingByNameAndSet(name, setCode);
    if (byName) {
      return { ok: true, card: toResolvedCard(byName) };
    }
  }

  return {
    ok: false,
    error: "not_found",
    suggestions: collectorNumber ? suggestSets(collectorNumber) : [],
  };
}
