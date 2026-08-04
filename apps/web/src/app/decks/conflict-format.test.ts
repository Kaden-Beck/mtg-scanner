import { describe, expect, it } from "vitest";
import type { ContendedStack, DeckClaim } from "@/server/decks/allocation";
import { conflictLabel, conflictLine, conflictSummary } from "./conflict-format";

function claim(deckId: string, deckName: string, quantity = 1): DeckClaim {
  return { deckId, deckName, quantity };
}

function contended(competing: DeckClaim[], shortBy = 1): ContendedStack {
  return {
    collectionItemId: "s1",
    stackQuantity: 1,
    totalClaimed: 1 + shortBy,
    shortBy,
    competingDecks: competing,
  };
}

describe("conflictLine", () => {
  it("is empty when there is no conflict", () => {
    expect(conflictLine([])).toBe("");
  });

  it("names a single competing deck", () => {
    expect(conflictLine([contended([claim("d2", "Yeva")])])).toBe("Also in Yeva");
  });

  it("joins two decks with 'and', biggest claim first", () => {
    expect(conflictLine([contended([claim("d2", "Yeva", 2), claim("d3", "Krenko", 1)])])).toBe(
      "Also in Yeva and Krenko",
    );
  });

  it("breaks a tie alphabetically, so the order is stable across reads", () => {
    expect(conflictLine([contended([claim("d2", "Yeva", 1), claim("d3", "Krenko", 1)])])).toBe(
      "Also in Krenko and Yeva",
    );
  });

  it("collapses past two into a count", () => {
    const line = conflictLine([
      contended([
        claim("d2", "Yeva", 4),
        claim("d3", "Krenko", 3),
        claim("d4", "Atraxa", 2),
        claim("d5", "Muldrotha", 1),
      ]),
    ]);
    // Ordered by how much each claims, so the biggest competitors are the
    // ones actually named.
    expect(line).toBe("Also in Yeva, Krenko and 2 more");
  });

  it("dedupes a deck contending on two stacks of the same card", () => {
    const line = conflictLine([contended([claim("d2", "Yeva")]), contended([claim("d2", "Yeva")])]);
    expect(line).toBe("Also in Yeva");
  });
});

describe("conflictLabel", () => {
  it("is empty when there is no conflict", () => {
    expect(conflictLabel("Sol Ring", [])).toBe("");
  });

  it("spells out the shortfall the short line leaves implicit", () => {
    expect(conflictLabel("Sol Ring", [contended([claim("d2", "Yeva")], 1)])).toBe(
      "Sol Ring: short 1 copy, also allocated to Yeva",
    );
  });

  it("pluralizes copies", () => {
    expect(conflictLabel("Sol Ring", [contended([claim("d2", "Yeva")], 3)])).toBe(
      "Sol Ring: short 3 copies, also allocated to Yeva",
    );
  });

  it("lists every competing deck, not just the named ones", () => {
    // The visible line truncates; the accessible sentence must not, or a
    // screen-reader user loses information a sighted user could get by
    // hovering.
    const label = conflictLabel("Sol Ring", [
      contended([claim("d2", "Yeva", 3), claim("d3", "Krenko", 2), claim("d4", "Atraxa", 1)], 2),
    ]);
    expect(label).toBe("Sol Ring: short 2 copies, also allocated to Yeva, Krenko and Atraxa");
  });
});

describe("conflictSummary", () => {
  it("is empty when nothing is contended", () => {
    expect(conflictSummary(new Map())).toBe("");
  });

  it("counts one card against one deck", () => {
    const map = new Map([["e1", [contended([claim("d2", "Yeva")])]]]);
    expect(conflictSummary(map)).toBe("1 card also allocated to another deck");
  });

  it("counts cards and distinct decks", () => {
    const map = new Map([
      ["e1", [contended([claim("d2", "Yeva")])]],
      ["e2", [contended([claim("d3", "Krenko")])]],
      ["e3", [contended([claim("d2", "Yeva")])]],
    ]);
    expect(conflictSummary(map)).toBe("3 cards also allocated to 2 other decks");
  });
});
