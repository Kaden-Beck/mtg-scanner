import { describe, expect, it } from "vitest";
import {
  type AllocatableStack,
  type ContendedStack,
  competingDeckNames,
  type DeckClaim,
  detectConflicts,
  freeCapacity,
  planAllocation,
} from "./allocation";

function stack(collectionItemId: string, quantity: number, claimedByOthers = 0): AllocatableStack {
  return { collectionItemId, quantity, claimedByOthers };
}

describe("freeCapacity", () => {
  it("is what nobody else has claimed", () => {
    expect(freeCapacity(stack("s1", 4, 1))).toBe(3);
  });

  it("floors at zero rather than going negative", () => {
    // An already over-committed stack has no capacity, not anti-capacity -
    // and a negative would corrupt the sort in planAllocation.
    expect(freeCapacity(stack("s1", 1, 3))).toBe(0);
  });
});

describe("planAllocation", () => {
  it("allocates nothing when the user owns no copies", () => {
    // An ownership gap (KAD-32's badge), not a conflict. Inventing a claim
    // against a stack that does not exist would report it as one.
    expect(planAllocation(4, [])).toEqual([]);
  });

  it("allocates nothing for a zero-quantity entry", () => {
    expect(planAllocation(0, [stack("s1", 4)])).toEqual([]);
  });

  it("takes what it needs from a single stack", () => {
    expect(planAllocation(2, [stack("s1", 4)])).toEqual([{ collectionItemId: "s1", quantity: 2 }]);
  });

  it("spreads across stacks when one is not enough", () => {
    const plan = planAllocation(3, [stack("s1", 2), stack("s2", 2)]);
    expect(plan.reduce((sum, item) => sum + item.quantity, 0)).toBe(3);
    expect(plan).toHaveLength(2);
  });

  it("prefers the stack nobody else has claimed", () => {
    // The manufactured-conflict case: greedily taking s1 every time would
    // make four decks fight over one copy while an identical one sat free.
    const plan = planAllocation(1, [stack("s1", 1, 1), stack("s2", 1, 0)]);
    expect(plan).toEqual([{ collectionItemId: "s2", quantity: 1 }]);
  });

  it("is stable across re-runs, so a deck does not churn its rows", () => {
    const stacks = [stack("b", 2), stack("a", 2), stack("c", 2)];
    expect(planAllocation(2, stacks)).toEqual(planAllocation(2, stacks));
    // Ties break on id, so the choice is the same every sync.
    expect(planAllocation(2, stacks)).toEqual([{ collectionItemId: "a", quantity: 2 }]);
  });

  it("over-allocates rather than refusing, per ADR-004", () => {
    // The defining behavior of advisory semantics: the deck wants 4, the box
    // holds 1, and the plan records 4 so the conflict becomes visible. A
    // reservation model would clamp or throw here.
    const plan = planAllocation(4, [stack("s1", 1)]);
    expect(plan).toEqual([{ collectionItemId: "s1", quantity: 4 }]);
  });

  it("puts the overflow on the largest stack", () => {
    const plan = planAllocation(6, [stack("small", 1), stack("big", 3)]);
    const byId = new Map(plan.map((item) => [item.collectionItemId, item.quantity]));
    expect(byId.get("small")).toBe(1);
    expect(byId.get("big")).toBe(5);
    expect(plan.reduce((sum, item) => sum + item.quantity, 0)).toBe(6);
  });

  it("over-allocates onto a stack already fully claimed by others", () => {
    // No free capacity anywhere - the deck still records its intent.
    const plan = planAllocation(2, [stack("s1", 1, 1)]);
    expect(plan).toEqual([{ collectionItemId: "s1", quantity: 2 }]);
  });
});

function claim(deckId: string, deckName: string, quantity: number): DeckClaim {
  return { deckId, deckName, quantity };
}

describe("detectConflicts", () => {
  it("is silent when claims fit inside the stack", () => {
    // Two decks, two copies. Not a conflict - and reporting it as one would
    // make the warning worthless.
    const conflicts = detectConflicts("deck-1", [
      {
        collectionItemId: "s1",
        stackQuantity: 2,
        claims: [claim("deck-1", "Atraxa", 1), claim("deck-2", "Yeva", 1)],
      },
    ]);
    expect(conflicts).toEqual([]);
  });

  it("reports a conflict when two decks want the same single copy", () => {
    const conflicts = detectConflicts("deck-1", [
      {
        collectionItemId: "s1",
        stackQuantity: 1,
        claims: [claim("deck-1", "Atraxa", 1), claim("deck-2", "Yeva", 1)],
      },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.shortBy).toBe(1);
    expect(conflicts[0]?.totalClaimed).toBe(2);
    expect(conflicts[0]?.competingDecks.map((d) => d.deckName)).toEqual(["Yeva"]);
  });

  it("never names the deck being viewed among the competitors", () => {
    const conflicts = detectConflicts("deck-1", [
      {
        collectionItemId: "s1",
        stackQuantity: 1,
        claims: [claim("deck-1", "Atraxa", 1), claim("deck-2", "Yeva", 1)],
      },
    ]);
    expect(conflicts[0]?.competingDecks.map((d) => d.deckId)).not.toContain("deck-1");
  });

  it("stays silent when the shortfall is entirely the viewing deck's own", () => {
    // Deck wants 4 copies of a card it owns 1 of, with nobody else involved.
    // That is an ownership shortfall - KAD-32's badge already says so, and
    // repeating it as a "conflict" with no competing deck to name is noise.
    const conflicts = detectConflicts("deck-1", [
      { collectionItemId: "s1", stackQuantity: 1, claims: [claim("deck-1", "Atraxa", 4)] },
    ]);
    expect(conflicts).toEqual([]);
  });

  it("orders competing decks by how much they claim", () => {
    const conflicts = detectConflicts("deck-1", [
      {
        collectionItemId: "s1",
        stackQuantity: 1,
        claims: [
          claim("deck-1", "Atraxa", 1),
          claim("deck-2", "Yeva", 1),
          claim("deck-3", "Krenko", 3),
        ],
      },
    ]);
    expect(conflicts[0]?.competingDecks.map((d) => d.deckName)).toEqual(["Krenko", "Yeva"]);
  });

  it("reports each contended stack separately", () => {
    const conflicts = detectConflicts("deck-1", [
      {
        collectionItemId: "s1",
        stackQuantity: 1,
        claims: [claim("deck-1", "A", 1), claim("deck-2", "B", 1)],
      },
      { collectionItemId: "s2", stackQuantity: 5, claims: [claim("deck-1", "A", 1)] },
      {
        collectionItemId: "s3",
        stackQuantity: 2,
        claims: [claim("deck-1", "A", 2), claim("deck-3", "C", 1)],
      },
    ]);
    expect(conflicts.map((c) => c.collectionItemId)).toEqual(["s1", "s3"]);
  });

  it("counts a stack contended by three decks once, with both competitors", () => {
    const conflicts = detectConflicts("deck-1", [
      {
        collectionItemId: "s1",
        stackQuantity: 1,
        claims: [claim("deck-1", "A", 1), claim("deck-2", "B", 1), claim("deck-3", "C", 1)],
      },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.shortBy).toBe(2);
    expect(conflicts[0]?.competingDecks).toHaveLength(2);
  });
});

describe("competingDeckNames", () => {
  function contended(competing: DeckClaim[]): ContendedStack {
    return {
      collectionItemId: "s1",
      stackQuantity: 1,
      totalClaimed: 2,
      shortBy: 1,
      competingDecks: competing,
    };
  }

  it("dedupes a deck contending on two stacks of the same card", () => {
    const names = competingDeckNames([
      contended([claim("deck-2", "Yeva", 1)]),
      contended([claim("deck-2", "Yeva", 1)]),
    ]);
    expect(names).toEqual(["Yeva"]);
  });

  it("orders by total claimed across stacks", () => {
    const names = competingDeckNames([
      contended([claim("deck-2", "Yeva", 1), claim("deck-3", "Krenko", 1)]),
      contended([claim("deck-3", "Krenko", 2)]),
    ]);
    expect(names).toEqual(["Krenko", "Yeva"]);
  });

  it("is empty when there are no conflicts", () => {
    expect(competingDeckNames([])).toEqual([]);
  });
});
