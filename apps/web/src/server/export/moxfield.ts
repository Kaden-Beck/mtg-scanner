import type { CollectionExportRow } from "./row-schema";

/**
 * Moxfield-compatible deck-list text (KAD-23 AC1).
 *
 * **Lossy by design, and that is the whole point of documenting it here.**
 * This is a deck-list text format: there is nowhere in
 * `1 Lightning Bolt (LEA) 161` to put a binder location, a condition, a
 * proxy flag or a tag. Contorting the format to carry them would produce
 * something no other tool could read, which defeats the only reason to
 * emit it. So AC2's round-trip gate is scoped to JSON and CSV, and this
 * format states its limitation in the UI instead of pretending.
 *
 * What does survive: quantity, card name, set code, collector number, and
 * foil (via Moxfield's `*F*` marker). Etched foil is written as `*E*`,
 * which Moxfield accepts.
 */
export const MOXFIELD_LOSSY_FIELDS = [
  "binder location",
  "condition",
  "proxy flag",
  "language",
  "tags",
] as const;

function finishMarker(finish: CollectionExportRow["finish"]): string {
  switch (finish) {
    case "foil":
      return " *F*";
    case "etched":
      return " *E*";
    case "nonfoil":
      return "";
  }
}

/**
 * One line per stack, not per printing. Two stacks of the same printing in
 * different conditions are two lines with the same name - deliberately not
 * summed, because summing would silently merge stacks the user keeps apart
 * and there is nothing in this format to explain why they were merged.
 */
export function toMoxfieldText(rows: readonly CollectionExportRow[]): string {
  const lines = rows.map(
    (row) =>
      `${String(row.quantity)} ${row.name} (${row.setCode.toUpperCase()}) ${row.collectorNumber}${finishMarker(row.finish)}`,
  );
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
