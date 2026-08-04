import { describe, expect, it } from "vitest";
import type { CorpusEntry } from "./manifest.ts";
import {
  buildReport,
  type Candidate,
  formatReport,
  percentile,
  type RecognitionResult,
  rate,
  type Tier,
} from "./metrics.ts";

function entry(overrides: Partial<CorpusEntry> = {}): CorpusEntry {
  return {
    image: "images/001.jpg",
    scryfallId: "6b3f2a4d-5c1e-4a8b-9d2f-7e0c3b5a1d84",
    oracleId: "0d1b1cb6-e5a1-4b6f-9a0d-2f3c4b5a6d7e",
    name: "Sol Ring",
    setCode: "c19",
    collectorNumber: "241",
    condition: "NM",
    finish: "nonfoil",
    sleeve: "none",
    frame: "2015",
    lighting: "bright",
    sharedArt: false,
    notes: "",
    ...overrides,
  };
}

function candidate(scryfallId: string, oracleId: string): Candidate {
  return { scryfallId, oracleId };
}

function result(
  image: string,
  candidates: Candidate[],
  tier: Tier = "T1",
  latencyMs = 100,
): RecognitionResult {
  return { image, candidates, tier, latencyMs };
}

const TRUE_PRINTING = "6b3f2a4d-5c1e-4a8b-9d2f-7e0c3b5a1d84";
const TRUE_ORACLE = "0d1b1cb6-e5a1-4b6f-9a0d-2f3c4b5a6d7e";
const OTHER_PRINTING = "2c9e7f14-8a3b-4d6e-b1f0-9c4a2e8d5b73";
const OTHER_ORACLE = "1e2c3d4f-6b7a-4c8d-9e0f-3a4b5c6d7e8f";

describe("buildReport", () => {
  it("scores an exact top-1 hit at both levels", () => {
    const report = buildReport(
      [entry()],
      [result("images/001.jpg", [candidate(TRUE_PRINTING, TRUE_ORACLE)])],
    );
    expect(rate(report.oracle, "top1")).toBe(1);
    expect(rate(report.printing, "top1")).toBe(1);
    expect(report.evaluated).toBe(1);
  });

  it("separates oracle from printing accuracy", () => {
    // The most important number the corpus produces: right card, wrong
    // printing. A scanner that always does this scores 100% oracle and 0%
    // printing, and reporting only one of them would hide it entirely.
    const report = buildReport(
      [entry()],
      [result("images/001.jpg", [candidate(OTHER_PRINTING, TRUE_ORACLE)])],
    );
    expect(rate(report.oracle, "top1")).toBe(1);
    expect(rate(report.printing, "top1")).toBe(0);
  });

  it("counts a hit outside the top slot as top-5 but not top-1", () => {
    const report = buildReport(
      [entry()],
      [
        result("images/001.jpg", [
          candidate(OTHER_PRINTING, OTHER_ORACLE),
          candidate(TRUE_PRINTING, TRUE_ORACLE),
        ]),
      ],
    );
    expect(rate(report.printing, "top1")).toBe(0);
    expect(rate(report.printing, "top5")).toBe(1);
  });

  it("does not count a hit at rank 6", () => {
    const filler = Array.from({ length: 5 }, () => candidate(OTHER_PRINTING, OTHER_ORACLE));
    const report = buildReport(
      [entry()],
      [result("images/001.jpg", [...filler, candidate(TRUE_PRINTING, TRUE_ORACLE)])],
    );
    expect(rate(report.printing, "top5")).toBe(0);
  });

  it("scores an empty candidate list as a miss, not a crash", () => {
    // "I could not read this card" is a real answer for a blurred shot.
    const report = buildReport([entry()], [result("images/001.jpg", [])]);
    expect(report.evaluated).toBe(1);
    expect(rate(report.printing, "top1")).toBe(0);
    expect(rate(report.oracle, "top5")).toBe(0);
  });

  it("counts entries the recognizer skipped instead of dropping them", () => {
    // A scanner that crashes on 40% of the corpus would otherwise post
    // excellent numbers on the 60% it survived.
    const report = buildReport(
      [entry({ image: "a.jpg" }), entry({ image: "b.jpg" })],
      [result("a.jpg", [candidate(TRUE_PRINTING, TRUE_ORACLE)])],
    );
    expect(report.evaluated).toBe(1);
    expect(report.missing).toBe(1);
    expect(rate(report.printing, "top1")).toBe(1);
  });

  it("reports shared-art printings separately from unique-art ones", () => {
    const report = buildReport(
      [
        entry({ image: "shared.jpg", sharedArt: true }),
        entry({ image: "unique.jpg", sharedArt: false }),
      ],
      [
        // Shared art: right oracle, wrong printing - the expected failure.
        result("shared.jpg", [candidate(OTHER_PRINTING, TRUE_ORACLE)]),
        result("unique.jpg", [candidate(TRUE_PRINTING, TRUE_ORACLE)]),
      ],
    );
    expect(rate(report.printingSharedArt, "top1")).toBe(0);
    expect(rate(report.printingUniqueArt, "top1")).toBe(1);
    // The headline number averages them, which is exactly why the split
    // has to be reported alongside it.
    expect(rate(report.printing, "top1")).toBe(0.5);
  });

  it("computes tier share and escalation rate", () => {
    const report = buildReport(
      [
        entry({ image: "a.jpg" }),
        entry({ image: "b.jpg" }),
        entry({ image: "c.jpg" }),
        entry({ image: "d.jpg" }),
      ],
      [
        result("a.jpg", [], "T1"),
        result("b.jpg", [], "T1"),
        result("c.jpg", [], "T2"),
        result("d.jpg", [], "T3"),
      ],
    );
    expect(report.tierShare.T1).toBe(0.5);
    expect(report.tierShare.T2).toBe(0.25);
    // T2, T3 and T4 count as escalation; T0 and T1 do not.
    expect(report.escalationRate).toBe(0.5);
  });

  it("does not count T0 or T1 as escalation", () => {
    const report = buildReport(
      [entry({ image: "a.jpg" }), entry({ image: "b.jpg" })],
      [result("a.jpg", [], "T0"), result("b.jpg", [], "T1")],
    );
    expect(report.escalationRate).toBe(0);
  });

  it("reports latency per tier", () => {
    const report = buildReport(
      [entry({ image: "a.jpg" }), entry({ image: "b.jpg" }), entry({ image: "c.jpg" })],
      [
        result("a.jpg", [], "T1", 10),
        result("b.jpg", [], "T1", 20),
        result("c.jpg", [], "T3", 900),
      ],
    );
    expect(report.latencyByTier.T1.count).toBe(2);
    expect(report.latencyByTier.T1.p50).toBe(10);
    expect(report.latencyByTier.T3.p50).toBe(900);
    expect(report.latencyByTier.T2.count).toBe(0);
  });

  it("answers zero rather than NaN for an empty corpus", () => {
    // A NaN would propagate silently through the regression gate.
    const report = buildReport([], []);
    expect(report.escalationRate).toBe(0);
    expect(rate(report.oracle, "top1")).toBe(0);
    expect(report.tierShare.T1).toBe(0);
  });
});

describe("percentile", () => {
  it("is nearest-rank, not interpolated", () => {
    // At ~10 samples per tier an interpolated p95 invents a latency no image
    // actually had.
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentile([10, 20, 30, 40], 0.95)).toBe(40);
  });

  it("handles a single sample and an empty list", () => {
    expect(percentile([42], 0.95)).toBe(42);
    expect(percentile([], 0.5)).toBe(0);
  });

  it("does not mutate its input", () => {
    const values = [30, 10, 20];
    percentile(values, 0.5);
    expect(values).toEqual([30, 10, 20]);
  });
});

describe("formatReport", () => {
  it("names the missing count only when there is one", () => {
    const clean = buildReport(
      [entry()],
      [result("images/001.jpg", [candidate(TRUE_PRINTING, TRUE_ORACLE)])],
    );
    expect(formatReport(clean)).not.toContain("MISSING");

    const gaps = buildReport([entry({ image: "a.jpg" })], []);
    expect(formatReport(gaps)).toContain("1 MISSING");
  });

  it("shows the shared-art split, which is the point of the report", () => {
    const report = buildReport(
      [entry({ image: "shared.jpg", sharedArt: true })],
      [result("shared.jpg", [candidate(OTHER_PRINTING, TRUE_ORACLE)])],
    );
    const text = formatReport(report);
    expect(text).toContain("shared art");
    expect(text).toContain("unique art");
  });

  it("omits tiers that answered nothing", () => {
    const report = buildReport([entry({ image: "a.jpg" })], [result("a.jpg", [], "T1", 5)]);
    const text = formatReport(report);
    expect(text).toContain("T1");
    expect(text).not.toContain("T4");
  });
});
