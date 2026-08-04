import type { DeckBoard } from "@mtg/schemas";
import type { CardRow, DeckCardRow } from "@/server/db/schema";

/**
 * Pure view logic for the deck editor (KAD-27), kept out of the page for the
 * ADR-007 reason: Vitest can't render an async Server Component, so grouping
 * and summary logic lives here where a `.test.ts` can reach it.
 */

export interface DeckEntryView {
  entry: DeckCardRow;
  card: CardRow;
}

export interface CategoryGroup {
  category: string;
  /** What to show as the heading - `category` is "" for uncategorized. */
  label: string;
  entries: DeckEntryView[];
  count: number;
}

export const UNCATEGORIZED_LABEL = "Uncategorized";

/**
 * Groups a board's cards by user-defined category (the AC), alphabetically,
 * with uncategorized last rather than first - an empty string sorts before
 * everything, which would otherwise put the least meaningful group at the
 * top of the page.
 */
export function groupByCategory(entries: DeckEntryView[]): CategoryGroup[] {
  const groups = new Map<string, DeckEntryView[]>();
  for (const item of entries) {
    const existing = groups.get(item.entry.category);
    if (existing) existing.push(item);
    else groups.set(item.entry.category, [item]);
  }

  return [...groups.entries()]
    .map(([category, items]) => ({
      category,
      label: category === "" ? UNCATEGORIZED_LABEL : category,
      entries: [...items].sort((a, b) => a.card.name.localeCompare(b.card.name)),
      count: items.reduce((total, item) => total + item.entry.quantity, 0),
    }))
    .sort((a, b) => {
      if (a.category === "") return 1;
      if (b.category === "") return -1;
      return a.category.localeCompare(b.category);
    });
}

export function entriesForBoard(entries: DeckEntryView[], board: DeckBoard): DeckEntryView[] {
  return entries.filter((item) => item.entry.board === board);
}

export function boardCount(entries: DeckEntryView[], board: DeckBoard): number {
  return entriesForBoard(entries, board).reduce((total, item) => total + item.entry.quantity, 0);
}

/** Distinct categories already used in this deck, for the datalist that
 * makes the free-form category field behave like a picker without becoming
 * a closed vocabulary. */
export function knownCategories(entries: DeckEntryView[]): string[] {
  const categories = new Set<string>();
  for (const item of entries) {
    if (item.entry.category !== "") categories.add(item.entry.category);
  }
  return [...categories].sort((a, b) => a.localeCompare(b));
}

export function cardImageUrl(card: CardRow, size: "small" | "normal" = "normal"): string | null {
  return card.imageUris?.[size] ?? card.imageUris?.["normal"] ?? card.imageUris?.["small"] ?? null;
}

/** "3 in Main · 2 in Maybe" style summary, omitting empty boards. */
export function boardSummary(entries: DeckEntryView[]): string {
  const parts: string[] = [];
  const main = boardCount(entries, "main");
  const side = boardCount(entries, "side");
  const maybe = boardCount(entries, "maybe");
  if (main > 0) parts.push(`${String(main)} in Main`);
  if (side > 0) parts.push(`${String(side)} in Sideboard`);
  if (maybe > 0) parts.push(`${String(maybe)} in Maybe`);
  return parts.length > 0 ? parts.join(" · ") : "Empty deck";
}
