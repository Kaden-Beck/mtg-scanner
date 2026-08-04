import type { DeckBoard } from "@mtg/schemas";
import { describe, expect, it } from "vitest";
import type { CardRow, DeckCardRow } from "@/server/db/schema";
import { buildCard } from "@/server/decks/test-cards";
import {
  boardCount,
  boardSummary,
  cardImageUrl,
  type DeckEntryView,
  entriesForBoard,
  groupByCategory,
  knownCategories,
  UNCATEGORIZED_LABEL,
} from "./deck-view";

let counter = 0;

function view(
  name: string,
  category: string,
  quantity = 1,
  board: DeckBoard = "main",
  imageUris: Record<string, string> | null = null,
): DeckEntryView {
  counter += 1;
  const id = `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  const now = new Date();
  const card: CardRow = buildCard(id, { name, imageUris, createdAt: now, updatedAt: now });
  const entry: DeckCardRow = {
    id: `entry-${String(counter)}`,
    deckId: "deck-1",
    scryfallId: id,
    board,
    category,
    quantity,
    createdAt: now,
    updatedAt: now,
  };
  return { entry, card };
}

describe("groupByCategory", () => {
  it("groups by the user-defined category", () => {
    const groups = groupByCategory([
      view("Llanowar Elves", "ramp"),
      view("Rampant Growth", "ramp"),
      view("Swords to Plowshares", "removal"),
    ]);
    expect(groups.map((group) => group.category)).toEqual(["ramp", "removal"]);
    expect(groups[0]?.entries).toHaveLength(2);
  });

  it("puts uncategorized last, not first", () => {
    // "" sorts before everything, which would otherwise park the least
    // meaningful group at the top of the page.
    const groups = groupByCategory([view("Sol Ring", ""), view("Cultivate", "ramp")]);
    expect(groups.map((group) => group.label)).toEqual(["ramp", UNCATEGORIZED_LABEL]);
  });

  it("sorts cards within a group by name", () => {
    const groups = groupByCategory([view("Zur", "misc"), view("Aura Shards", "misc")]);
    expect(groups[0]?.entries.map((item) => item.card.name)).toEqual(["Aura Shards", "Zur"]);
  });

  it("counts by quantity, not by row", () => {
    const groups = groupByCategory([view("Forest", "lands", 20), view("Island", "lands", 5)]);
    expect(groups[0]?.count).toBe(25);
  });

  it("returns nothing for an empty deck", () => {
    expect(groupByCategory([])).toEqual([]);
  });
});

describe("entriesForBoard / boardCount", () => {
  it("separates the boards", () => {
    const entries = [
      view("Sol Ring", "", 1, "main"),
      view("Mana Crypt", "", 1, "maybe"),
      view("Bolt", "", 2, "side"),
    ];
    expect(entriesForBoard(entries, "main")).toHaveLength(1);
    expect(boardCount(entries, "side")).toBe(2);
    expect(boardCount(entries, "main")).toBe(1);
  });
});

describe("knownCategories", () => {
  it("lists distinct categories alphabetically and omits uncategorized", () => {
    const entries = [
      view("A", "removal"),
      view("B", "ramp"),
      view("C", "ramp"),
      view("D", ""),
    ];
    expect(knownCategories(entries)).toEqual(["ramp", "removal"]);
  });
});

describe("cardImageUrl", () => {
  it("prefers the requested size", () => {
    const entry = view("Sol Ring", "", 1, "main", { small: "s.jpg", normal: "n.jpg" });
    expect(cardImageUrl(entry.card, "small")).toBe("s.jpg");
    expect(cardImageUrl(entry.card, "normal")).toBe("n.jpg");
  });

  it("falls back when the requested size is absent", () => {
    const entry = view("Sol Ring", "", 1, "main", { small: "s.jpg" });
    expect(cardImageUrl(entry.card, "normal")).toBe("s.jpg");
  });

  it("is null when the card has no images at all", () => {
    expect(cardImageUrl(view("Sol Ring", "").card)).toBeNull();
  });
});

describe("boardSummary", () => {
  it("omits empty boards", () => {
    const entries = [view("Sol Ring", "", 3, "main"), view("Bolt", "", 2, "maybe")];
    expect(boardSummary(entries)).toBe("3 in Main · 2 in Maybe");
  });

  it("says so when the deck is empty", () => {
    expect(boardSummary([])).toBe("Empty deck");
  });
});
