import { describe, expect, it } from "vitest";
import {
  LEGALITY_RULES,
  type LegalityResult,
  type LegalityViolation,
} from "@/server/decks/legality";
import {
  groupViolations,
  ruleLabel,
  ruleRemedy,
  verdictSummary,
  verdictTone,
  violationLine,
} from "./legality-format";

function violation(overrides: Partial<LegalityViolation> = {}): LegalityViolation {
  return {
    rule: "singleton",
    cardName: "Sol Ring",
    scryfallId: "card-1",
    detail: "Commander is a singleton format, but this deck has 2 copies of Sol Ring.",
    ...overrides,
  };
}

function result(overrides: Partial<LegalityResult> = {}): LegalityResult {
  return {
    legal: false,
    validated: true,
    format: "commander",
    colorIdentity: ["G"],
    violations: [violation()],
    ...overrides,
  };
}

describe("ruleLabel / ruleRemedy", () => {
  it("covers every rule", () => {
    // Exhaustiveness is enforced by assertNever at compile time; this
    // catches a rule added to the tuple but never given a label.
    for (const rule of LEGALITY_RULES) {
      expect(ruleLabel(rule).length).toBeGreaterThan(0);
      expect(ruleRemedy(rule).length).toBeGreaterThan(0);
    }
  });

  it("gives a remedy distinct from the label", () => {
    for (const rule of LEGALITY_RULES) {
      expect(ruleRemedy(rule)).not.toBe(ruleLabel(rule));
    }
  });
});

describe("violationLine", () => {
  it("names the specific card (AC2)", () => {
    expect(violationLine(violation())).toContain("Sol Ring");
  });

  it("falls back to the detail for deck-level rules with no card", () => {
    const line = violationLine(
      violation({
        rule: "deck_size",
        cardName: null,
        scryfallId: null,
        detail: "A Commander deck must be exactly 100 cards.",
      }),
    );
    expect(line).toBe("A Commander deck must be exactly 100 cards.");
    expect(line.startsWith(":")).toBe(false);
  });
});

describe("groupViolations", () => {
  it("drops rules with no violations", () => {
    expect(groupViolations([violation()]).map((group) => group.rule)).toEqual(["singleton"]);
  });

  it("leads with the missing commander rather than its downstream consequences", () => {
    // A deck with no commander produces one commander_missing plus a
    // color-identity error for every colored card. Reporting 60 identity
    // errors first would bury the one thing the user has to fix.
    const groups = groupViolations([
      violation({ rule: "color_identity", cardName: "Llanowar Elves" }),
      violation({ rule: "commander_missing", cardName: null, scryfallId: null }),
    ]);
    expect(groups[0]?.rule).toBe("commander_missing");
  });

  it("orders banlist above deck size", () => {
    const groups = groupViolations([
      violation({ rule: "deck_size", cardName: null }),
      violation({ rule: "banlist", cardName: "Black Lotus" }),
    ]);
    expect(groups.map((group) => group.rule)).toEqual(["banlist", "deck_size"]);
  });

  it("keeps every violation within its group", () => {
    const groups = groupViolations([
      violation({ cardName: "Sol Ring" }),
      violation({ cardName: "Lightning Bolt" }),
    ]);
    expect(groups[0]?.violations).toHaveLength(2);
  });

  it("returns nothing for a legal deck", () => {
    expect(groupViolations([])).toEqual([]);
  });
});

describe("verdictSummary", () => {
  it("never says only 'illegal' - it counts problems and rules", () => {
    const summary = verdictSummary(
      result({
        violations: [violation(), violation({ rule: "banlist", cardName: "Black Lotus" })],
      }),
    );
    expect(summary).toContain("2 problems");
    expect(summary).toContain("2 rules");
  });

  it("singularises a lone problem", () => {
    const summary = verdictSummary(result());
    expect(summary).toContain("1 problem");
    expect(summary).toContain("1 rule");
    expect(summary).not.toContain("1 problems");
  });

  it("counts distinct rules, not violations", () => {
    const summary = verdictSummary(
      result({
        violations: [
          violation({ cardName: "Sol Ring" }),
          violation({ cardName: "Lightning Bolt" }),
        ],
      }),
    );
    expect(summary).toContain("2 problems");
    expect(summary).toContain("1 rule");
  });

  it("reports a legal deck plainly", () => {
    expect(verdictSummary(result({ legal: true, violations: [] }))).toBe(
      "This deck is legal for Commander.",
    );
  });

  it("says an unvalidated format is unchecked rather than legal", () => {
    const summary = verdictSummary(
      result({ validated: false, legal: true, format: "modern", violations: [] }),
    );
    expect(summary).toContain("not checked");
    expect(summary).toContain("modern");
  });
});

describe("verdictTone", () => {
  it("distinguishes unvalidated from legal", () => {
    expect(verdictTone(result({ validated: false, legal: true, violations: [] }))).toBe(
      "unvalidated",
    );
    expect(verdictTone(result({ legal: true, violations: [] }))).toBe("legal");
    expect(verdictTone(result())).toBe("illegal");
  });
});
