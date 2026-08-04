import { describe, expect, it } from "vitest";
import {
  type Baseline,
  buildBaseline,
  compareToBaseline,
  formatGateResult,
  REGRESSION_TOLERANCE,
} from "./baseline.ts";
import type { AccuracyStats, Report, Tier } from "./metrics.ts";
import { TIERS } from "./metrics.ts";

function stats(count: number, top1: number, top5: number): AccuracyStats {
  return { count, top1, top5 };
}

/** A report with the four gated metrics set directly, so the gate's own
 *  behavior is tested without going through buildReport. */
function report(oracleTop1: number, printingTop1: number, evaluated = 100): Report {
  const zero = Object.fromEntries(TIERS.map((tier) => [tier, 0])) as Record<Tier, number>;
  return {
    evaluated,
    missing: 0,
    oracle: stats(100, oracleTop1 * 100, 100),
    printing: stats(100, printingTop1 * 100, 100),
    printingSharedArt: stats(0, 0, 0),
    printingUniqueArt: stats(0, 0, 0),
    tierShare: zero,
    escalationRate: 0,
    latencyByTier: Object.fromEntries(
      TIERS.map((tier) => [tier, { p50: 0, p95: 0, count: 0 }]),
    ) as Report["latencyByTier"],
  };
}

function baseline(oracleTop1: number, printingTop1: number, corpusSize = 100): Baseline {
  return {
    version: 1,
    recordedAt: "2026-08-04",
    commit: "abc1234",
    corpusSize,
    metrics: {
      oracleTop1,
      oracleTop5: 1,
      printingTop1,
      printingTop5: 1,
    },
  };
}

describe("compareToBaseline", () => {
  it("passes when nothing changed", () => {
    const result = compareToBaseline(baseline(0.95, 0.9), report(0.95, 0.9));
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("passes on an improvement", () => {
    const result = compareToBaseline(baseline(0.9, 0.85), report(0.97, 0.93));
    expect(result.passed).toBe(true);
  });

  it("tolerates a drop of exactly one percentage point", () => {
    // The AC's wording is "not regress *more than* 1pp", so 1.0pp exactly
    // is inside the gate, not outside it.
    const result = compareToBaseline(baseline(0.95, 0.9), report(0.94, 0.9));
    expect(result.passed).toBe(true);
  });

  it("fails on a drop past the tolerance", () => {
    const result = compareToBaseline(baseline(0.95, 0.9), report(0.93, 0.9));
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.metric).toBe("oracleTop1");
    expect(result.failures[0]?.droppedBy).toBeCloseTo(0.02);
  });

  it("reports every regressed metric, not just the first", () => {
    const result = compareToBaseline(baseline(0.95, 0.9), report(0.8, 0.7));
    expect(result.failures.map((failure) => failure.metric).sort()).toEqual([
      "oracleTop1",
      "printingTop1",
    ]);
  });

  it("gates printing accuracy independently of oracle accuracy", () => {
    // A change that keeps finding the right card but loses the right
    // printing must fail, even though the headline oracle number is fine.
    const result = compareToBaseline(baseline(0.95, 0.9), report(0.95, 0.5));
    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.metric)).toEqual(["printingTop1"]);
  });

  it("always reports deltas, passing or failing", () => {
    const result = compareToBaseline(baseline(0.95, 0.9), report(0.96, 0.91));
    expect(result.deltas).toHaveLength(4);
  });

  it("warns when the corpus size changed", () => {
    // Adding photos is normal, but the comparison stops being apples to
    // apples and passing quietly would hide that.
    const result = compareToBaseline(baseline(0.95, 0.9, 300), report(0.95, 0.9, 420));
    expect(result.warning).toContain("300");
    expect(result.warning).toContain("420");
  });

  it("does not warn when the corpus size matches", () => {
    expect(compareToBaseline(baseline(0.95, 0.9, 300), report(0.95, 0.9, 300)).warning).toBe(
      undefined,
    );
  });

  it("still gates a regression when the corpus size changed", () => {
    // The warning must not become an escape hatch that turns a real
    // regression into a note.
    const result = compareToBaseline(baseline(0.95, 0.9, 300), report(0.5, 0.9, 420));
    expect(result.passed).toBe(false);
    expect(result.warning).toBeDefined();
  });

  it("uses a one-percentage-point tolerance", () => {
    expect(REGRESSION_TOLERANCE).toBe(0.01);
  });
});

describe("formatGateResult", () => {
  it("shows the direction of each change", () => {
    const text = formatGateResult(compareToBaseline(baseline(0.9, 0.9), report(0.95, 0.85)));
    expect(text).toContain("+5.0%");
    expect(text).toContain("-5.0%");
  });

  it("spells out what regressed", () => {
    const text = formatGateResult(compareToBaseline(baseline(0.95, 0.9), report(0.8, 0.9)));
    expect(text).toContain("REGRESSED");
    expect(text).toContain("oracleTop1");
  });

  it("leads with the warning when there is one", () => {
    const text = formatGateResult(compareToBaseline(baseline(0.95, 0.9, 300), report(0.95, 0.9)));
    expect(text.startsWith("WARNING:")).toBe(true);
  });
});

describe("buildBaseline", () => {
  it("captures the corpus size it was measured against", () => {
    const built = buildBaseline(report(0.95, 0.9, 412), "deadbee", "2026-08-04");
    expect(built.corpusSize).toBe(412);
    expect(built.commit).toBe("deadbee");
    expect(built.metrics.oracleTop1).toBeCloseTo(0.95);
  });

  it("round-trips through compareToBaseline as a pass", () => {
    const current = report(0.93, 0.87, 350);
    const built = buildBaseline(current, "abc", "2026-08-04");
    expect(compareToBaseline(built, current).passed).toBe(true);
  });
});
