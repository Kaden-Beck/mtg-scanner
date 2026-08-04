import { describe, expect, it } from "vitest";
import { type OwnedStack, resolveEntryOwnership } from "@/server/decks/ownership";
import {
  ownershipBadgeLabel,
  ownershipBadgeText,
  ownershipDetail,
  ownershipLabel,
} from "./ownership-format";

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

describe("ownershipLabel", () => {
  it("names each status", () => {
    expect(ownershipLabel("owned")).toBe("Owned");
    expect(ownershipLabel("partial")).toBe("Partial");
    expect(ownershipLabel("unowned")).toBe("Not owned");
  });
});

describe("ownershipBadgeText", () => {
  it("shows the ratio only when partially owned", () => {
    expect(ownershipBadgeText(resolveEntryOwnership(4, [stack({ quantity: 1 })]))).toBe("1/4");
    expect(ownershipBadgeText(resolveEntryOwnership(1, [stack()]))).toBe("Owned");
    expect(ownershipBadgeText(resolveEntryOwnership(1, []))).toBe("Not owned");
  });
});

describe("ownershipBadgeLabel", () => {
  it("spells out the counts, since colour alone carries the status", () => {
    expect(
      ownershipBadgeLabel("Sol Ring", resolveEntryOwnership(4, [stack({ quantity: 1 })])),
    ).toBe("Sol Ring: partially owned, 1 of 4 needed");
    expect(ownershipBadgeLabel("Sol Ring", resolveEntryOwnership(1, [stack()]))).toBe(
      "Sol Ring: owned, 1 of 1 needed",
    );
    expect(ownershipBadgeLabel("Sol Ring", resolveEntryOwnership(1, []))).toBe(
      "Sol Ring: not owned",
    );
  });
});

describe("ownershipDetail", () => {
  it("is empty for an unowned card - there is no copy to locate", () => {
    expect(ownershipDetail(resolveEntryOwnership(1, []))).toBe("");
  });

  it("leads with the binder location", () => {
    expect(ownershipDetail(resolveEntryOwnership(1, [stack({ binderLocation: "Binder 2" })]))).toBe(
      "Binder 2",
    );
  });

  it("says so when the copy is filed nowhere", () => {
    expect(ownershipDetail(resolveEntryOwnership(1, [stack()]))).toBe("No location recorded");
  });

  it("flags that the only copies are a different printing", () => {
    const ownership = resolveEntryOwnership(1, [
      stack({ scryfallId: CARD_B, exactPrinting: false, binderLocation: "Binder 1" }),
    ]);
    expect(ownershipDetail(ownership)).toBe("Binder 1 · different printing");
  });

  it("does not flag a different printing when an exact copy exists too", () => {
    // Owning a spare in another art is noise once the named printing is in
    // hand.
    const ownership = resolveEntryOwnership(2, [
      stack({ collectionItemId: "s1", binderLocation: "Binder 1" }),
      stack({ collectionItemId: "s2", scryfallId: CARD_B, exactPrinting: false }),
    ]);
    expect(ownershipDetail(ownership)).toBe("Binder 1");
  });

  it("marks a wholly proxied entry", () => {
    const ownership = resolveEntryOwnership(1, [stack({ isProxy: true, binderLocation: "Box" })]);
    expect(ownershipDetail(ownership)).toBe("Box · proxy");
  });

  it("counts proxies when only some copies are proxied", () => {
    const ownership = resolveEntryOwnership(3, [
      stack({ collectionItemId: "s1", quantity: 2, binderLocation: "Box" }),
      stack({ collectionItemId: "s2", quantity: 1, isProxy: true, binderLocation: "Box" }),
    ]);
    expect(ownershipDetail(ownership)).toBe("Box · 1 proxy");
  });
});
