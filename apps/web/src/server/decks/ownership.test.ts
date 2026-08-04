import { describe, expect, it } from "vitest";
import {
  type EntryOwnership,
  formatUnownedSummary,
  formatUsd,
  locationSummary,
  type OwnedStack,
  resolveEntryOwnership,
  summarizeUnowned,
  unitPriceUsd,
} from "./ownership";
import { buildCard } from "./test-cards";

const CARD_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CARD_B = "bbbbbbbb-0000-4000-8000-000000000002";

function stack(overrides: Partial<OwnedStack> = {}): OwnedStack {
  return {
    collectionItemId: "stack-1",
    scryfallId: CARD_A,
    quantity: 1,
    finish: "nonfoil",
    condition: "NM",
    binderLocation: "",
    isProxy: false,
    exactPrinting: true,
    ...overrides,
  };
}

describe("resolveEntryOwnership", () => {
  it("is unowned when no stack backs the entry", () => {
    const result = resolveEntryOwnership(1, []);
    expect(result.status).toBe("unowned");
    expect(result.owned).toBe(0);
    expect(result.missing).toBe(1);
  });

  it("is owned when the exact printing covers the requirement", () => {
    const result = resolveEntryOwnership(2, [stack({ quantity: 2 })]);
    expect(result.status).toBe("owned");
    expect(result.ownedExact).toBe(2);
    expect(result.missing).toBe(0);
  });

  it("is partial when some but not all copies are owned", () => {
    const result = resolveEntryOwnership(4, [stack({ quantity: 1 })]);
    expect(result.status).toBe("partial");
    expect(result.missing).toBe(3);
  });

  it("sums across multiple stacks of the same card", () => {
    // Two stacks because they differ in condition - the KAD-12 stack index
    // keeps them as separate rows, and ownership has to add them back up.
    const result = resolveEntryOwnership(3, [
      stack({ collectionItemId: "s1", condition: "NM", quantity: 1 }),
      stack({ collectionItemId: "s2", condition: "MP", quantity: 2 }),
    ]);
    expect(result.owned).toBe(3);
    expect(result.status).toBe("owned");
  });

  it("counts a different printing of the same card as owned", () => {
    // The whole reason matching is oracle-level: in paper, any Sol Ring is
    // a Sol Ring. Reporting this as unowned would send the user shopping
    // for a card sitting in their box.
    const result = resolveEntryOwnership(1, [stack({ scryfallId: CARD_B, exactPrinting: false })]);
    expect(result.status).toBe("owned");
    expect(result.ownedExact).toBe(0);
    expect(result.ownedOtherPrinting).toBe(1);
  });

  it("counts proxies as owned but reports them separately", () => {
    const result = resolveEntryOwnership(1, [stack({ isProxy: true })]);
    expect(result.status).toBe("owned");
    expect(result.ownedProxy).toBe(1);
  });

  it("never reports negative missing when the user owns a spare", () => {
    const result = resolveEntryOwnership(1, [stack({ quantity: 9 })]);
    expect(result.missing).toBe(0);
    expect(result.owned).toBe(9);
  });

  it("puts the exact printing first, then orders by location", () => {
    const result = resolveEntryOwnership(3, [
      stack({ collectionItemId: "other", exactPrinting: false, binderLocation: "Binder 1" }),
      stack({ collectionItemId: "exact-b", binderLocation: "Binder 9" }),
      stack({ collectionItemId: "exact-a", binderLocation: "Binder 2" }),
    ]);
    expect(result.stacks.map((s) => s.collectionItemId)).toEqual(["exact-a", "exact-b", "other"]);
  });
});

describe("locationSummary", () => {
  function withStacks(stacks: OwnedStack[]): EntryOwnership {
    return resolveEntryOwnership(1, stacks);
  }

  it("lists distinct locations", () => {
    const summary = locationSummary(
      withStacks([
        stack({ collectionItemId: "s1", binderLocation: "Binder 2" }),
        stack({ collectionItemId: "s2", binderLocation: "Deck box" }),
      ]),
    );
    expect(summary).toBe("Binder 2, Deck box");
  });

  it("dedupes a location shared by two stacks", () => {
    const summary = locationSummary(
      withStacks([
        stack({ collectionItemId: "s1", binderLocation: "Binder 2", condition: "NM" }),
        stack({ collectionItemId: "s2", binderLocation: "Binder 2", condition: "LP" }),
      ]),
    );
    expect(summary).toBe("Binder 2");
  });

  it("is empty when nothing is filed", () => {
    // The default for a freshly imported collection - blank, not null.
    expect(locationSummary(withStacks([stack()]))).toBe("");
  });

  it("is empty when nothing is owned", () => {
    expect(locationSummary(withStacks([]))).toBe("");
  });
});

describe("unitPriceUsd", () => {
  it("prefers the nonfoil price", () => {
    const card = buildCard(CARD_A, { prices: { usd: "1.50", usd_foil: "9.00" } });
    expect(unitPriceUsd(card)).toBe(1.5);
  });

  it("falls back to foil for a foil-only printing", () => {
    // Secret Lairs and promos have `usd: null`; without this fallback they
    // would count as free in the estimate.
    const card = buildCard(CARD_A, { prices: { usd: null, usd_foil: "12.00" } });
    expect(unitPriceUsd(card)).toBe(12);
  });

  it("falls back to etched when that is all there is", () => {
    const card = buildCard(CARD_A, { prices: { usd_etched: "4.25" } });
    expect(unitPriceUsd(card)).toBe(4.25);
  });

  it("is null when the printing has no price at all", () => {
    expect(unitPriceUsd(buildCard(CARD_A, { prices: {} }))).toBeNull();
  });

  it("is null rather than NaN when the price is unparseable", () => {
    expect(unitPriceUsd(buildCard(CARD_A, { prices: { usd: "" } }))).toBeNull();
  });
});

describe("summarizeUnowned", () => {
  function item(price: string | null, needed: number, ownedQty: number) {
    return {
      card: buildCard(CARD_A, { prices: price === null ? {} : { usd: price } }),
      ownership: resolveEntryOwnership(needed, ownedQty > 0 ? [stack({ quantity: ownedQty })] : []),
    };
  }

  it("ignores fully owned cards", () => {
    const summary = summarizeUnowned([item("5.00", 1, 1)]);
    expect(summary).toEqual({
      cardCount: 0,
      copyCount: 0,
      estimatedCostUsd: 0,
      unpricedCount: 0,
    });
  });

  it("counts only the missing copies, not the whole requirement", () => {
    // 4 needed, 1 owned -> buying 3, not 4.
    const summary = summarizeUnowned([item("2.00", 4, 1)]);
    expect(summary.cardCount).toBe(1);
    expect(summary.copyCount).toBe(3);
    expect(summary.estimatedCostUsd).toBe(6);
  });

  it("reports unpriced missing cards instead of treating them as free", () => {
    const summary = summarizeUnowned([item(null, 1, 0), item("3.00", 1, 0)]);
    expect(summary.cardCount).toBe(2);
    expect(summary.estimatedCostUsd).toBe(3);
    expect(summary.unpricedCount).toBe(1);
  });

  it("does not accumulate float drift across many cheap cards", () => {
    const summary = summarizeUnowned(Array.from({ length: 10 }, () => item("0.10", 1, 0)));
    expect(summary.estimatedCostUsd).toBe(1);
  });
});

describe("formatUnownedSummary", () => {
  it("says so when the deck is fully owned", () => {
    expect(
      formatUnownedSummary({
        cardCount: 0,
        copyCount: 0,
        estimatedCostUsd: 0,
        unpricedCount: 0,
      }),
    ).toBe("Every card in this deck is owned");
  });

  it("omits the copy count when it matches the card count", () => {
    expect(
      formatUnownedSummary({
        cardCount: 3,
        copyCount: 3,
        estimatedCostUsd: 12.5,
        unpricedCount: 0,
      }),
    ).toBe("3 cards missing · ~$12.50");
  });

  it("includes copies and unpriced when they add information", () => {
    expect(
      formatUnownedSummary({
        cardCount: 12,
        copyCount: 14,
        estimatedCostUsd: 83.4,
        unpricedCount: 3,
      }),
    ).toBe("12 cards missing · 14 copies · ~$83.40 · 3 unpriced");
  });

  it("singularizes one card", () => {
    expect(
      formatUnownedSummary({
        cardCount: 1,
        copyCount: 1,
        estimatedCostUsd: 0.25,
        unpricedCount: 0,
      }),
    ).toBe("1 card missing · ~$0.25");
  });
});

describe("formatUsd", () => {
  it("always shows cents", () => {
    expect(formatUsd(5)).toBe("$5.00");
    expect(formatUsd(0)).toBe("$0.00");
  });
});
