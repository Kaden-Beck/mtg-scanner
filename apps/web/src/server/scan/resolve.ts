import { type ScanResolvedCard, scanResolvedCardSchema } from "@mtg/schemas";
import { findPrinting, suggestSets } from "../corpus/lookup.ts";

export type ResolvePrintingResult =
  | { ok: true; card: ScanResolvedCard }
  | { ok: false; error: "not_found"; suggestions: string[] };

/**
 * Exact set + collector-number → printing (KAD-44). Offline against the
 * local `cards` table — never hits Scryfall at scan time.
 */
export function resolvePrinting(setCode: string, collectorNumber: string): ResolvePrintingResult {
  const resolved = findPrinting(setCode, collectorNumber);
  if (!resolved) {
    return {
      ok: false,
      error: "not_found",
      suggestions: suggestSets(collectorNumber),
    };
  }

  const card = scanResolvedCardSchema.parse({
    scryfallId: resolved.card.id,
    oracleId: resolved.card.oracleId,
    name: resolved.card.name,
    setCode: resolved.card.setCode,
    collectorNumber: resolved.card.collectorNumber,
    sharedArt: resolved.sharedArt,
  });

  return { ok: true, card };
}
