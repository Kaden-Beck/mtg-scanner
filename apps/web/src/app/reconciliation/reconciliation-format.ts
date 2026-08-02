import { assertNever } from "@mtg/schemas";
import type { UnresolvedReason } from "@/server/db/schema";

export function reasonLabel(reason: UnresolvedReason): string {
  switch (reason) {
    case "insufficient_data":
      return "Missing name, set, or collector number";
    case "invalid_quantity":
      return "Missing or invalid quantity";
    case "scryfall_id_not_found":
      return "Scryfall ID not found in the card database";
    case "no_matching_printing":
      return "No matching printing found";
    case "ambiguous_printing":
      return "Multiple matching printings - pick one";
    default:
      return assertNever(reason);
  }
}
