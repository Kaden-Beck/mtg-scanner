import type { CorpusEntry } from "./manifest.ts";

/**
 * Accuracy reporting for the recognition corpus (KAD-37).
 *
 * Written before any recognizer exists, which is the point: the harness
 * consumes a `RecognitionResult` rather than calling a scanner, so the
 * definition of success is fixed now and each tier plugs into it as it lands
 * (T0 KAD-39 deferred, T1 KAD-40 deferred, T2 KAD-44 OCR-primary per ADR-008,
 * T3 KAD-51, T4 KAD-47).
 */

/** Which tier produced the answer. Ordered, so escalation is comparable. */
export const TIERS = ["T0", "T1", "T2", "T3", "T4"] as const;
export type Tier = (typeof TIERS)[number];

export interface Candidate {
  scryfallId: string;
  oracleId: string;
}

export interface RecognitionResult {
  /** The manifest entry's `image`, so results can be joined back to truth. */
  image: string;
  /**
   * Ranked best-first. May be empty: "I could not read this card" is a real
   * and *correct* answer for a blurred shot, and scoring it as a miss rather
   * than crashing is the whole reason this is an array.
   */
  candidates: Candidate[];
  /** The tier that produced these candidates. */
  tier: Tier;
  /** Wall-clock milliseconds for the whole pipeline on this image. */
  latencyMs: number;
}

export interface AccuracyStats {
  count: number;
  /** Ground truth was the single best candidate. */
  top1: number;
  /** Ground truth was anywhere in the top 5. */
  top5: number;
}

export interface Report {
  /** Entries the recognizer returned a result for. */
  evaluated: number;
  /** Manifest entries with no matching result - counted, never silently
   *  dropped, since a scanner that crashes on 40% of the corpus would
   *  otherwise post excellent numbers on the 60% it survived. */
  missing: number;

  oracle: AccuracyStats;
  printing: AccuracyStats;

  /** Printing accuracy on the shared-art cards specifically, and on the
   *  rest. Reported separately because they are different problems. */
  printingSharedArt: AccuracyStats;
  printingUniqueArt: AccuracyStats;

  /** Fraction of images answered by each tier. */
  tierShare: Record<Tier, number>;
  /**
   * Fraction of images that needed anything past T1.
   *
   * The cost metric: every escalation is latency and, at T3, an API call.
   * A pipeline can buy accuracy by escalating everything, and this is the
   * number that makes that visible instead of free.
   */
  escalationRate: number;
  /** Median and p95 latency per tier, in milliseconds. */
  latencyByTier: Record<Tier, { p50: number; p95: number; count: number }>;
}

const TOP_N = 5;

/** Builds a value per tier without a type assertion - `Object.fromEntries`
 *  widens its key type to `string`, and asserting it back is exactly the
 *  cast the lint rule exists to prevent. Listing the tiers keeps the record
 *  exhaustive by construction. */
function tierRecord<T>(make: (tier: Tier) => T): Record<Tier, T> {
  return {
    T0: make("T0"),
    T1: make("T1"),
    T2: make("T2"),
    T3: make("T3"),
    T4: make("T4"),
  };
}

function emptyStats(): AccuracyStats {
  return { count: 0, top1: 0, top5: 0 };
}

function score(stats: AccuracyStats, candidates: string[], truth: string): void {
  stats.count += 1;
  if (candidates[0] === truth) stats.top1 += 1;
  if (candidates.slice(0, TOP_N).includes(truth)) stats.top5 += 1;
}

/**
 * Percentile by nearest-rank on a sorted copy.
 *
 * Nearest-rank rather than interpolation: at the ~10-sample-per-tier sizes
 * this runs at, an interpolated p95 invents a latency no image actually had.
 */
export function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? 0;
}

export function buildReport(entries: CorpusEntry[], results: RecognitionResult[]): Report {
  const byImage = new Map(results.map((result) => [result.image, result]));

  const oracle = emptyStats();
  const printing = emptyStats();
  const printingSharedArt = emptyStats();
  const printingUniqueArt = emptyStats();

  const tierCounts = tierRecord(() => 0);
  const latencies = tierRecord<number[]>(() => []);

  let evaluated = 0;
  let missing = 0;

  for (const entry of entries) {
    const result = byImage.get(entry.image);
    if (!result) {
      missing += 1;
      continue;
    }
    evaluated += 1;

    score(
      oracle,
      result.candidates.map((candidate) => candidate.oracleId),
      entry.oracleId,
    );

    const printingIds = result.candidates.map((candidate) => candidate.scryfallId);
    score(printing, printingIds, entry.scryfallId);
    score(entry.sharedArt ? printingSharedArt : printingUniqueArt, printingIds, entry.scryfallId);

    tierCounts[result.tier] += 1;
    latencies[result.tier].push(result.latencyMs);
  }

  const tierShare = tierRecord((tier) => (evaluated === 0 ? 0 : tierCounts[tier] / evaluated));

  const latencyByTier = tierRecord((tier) => ({
    p50: percentile(latencies[tier], 0.5),
    p95: percentile(latencies[tier], 0.95),
    count: latencies[tier].length,
  }));

  const escalated = tierCounts.T2 + tierCounts.T3 + tierCounts.T4;

  return {
    evaluated,
    missing,
    oracle,
    printing,
    printingSharedArt,
    printingUniqueArt,
    tierShare,
    escalationRate: evaluated === 0 ? 0 : escalated / evaluated,
    latencyByTier,
  };
}

/** Accuracy as a fraction in [0, 1]. Zero samples answers 0, not NaN - a
 *  NaN would propagate silently through the regression gate's comparison. */
export function rate(stats: AccuracyStats, which: "top1" | "top5"): number {
  if (stats.count === 0) return 0;
  return stats[which] / stats.count;
}

export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/** Human-readable report, for the CI log and for a local run. */
export function formatReport(report: Report): string {
  const lines: string[] = [
    `Evaluated ${String(report.evaluated)} images` +
      (report.missing > 0 ? ` (${String(report.missing)} MISSING)` : ""),
    "",
    `Oracle    top-1 ${formatPercent(rate(report.oracle, "top1"))}  top-5 ${formatPercent(rate(report.oracle, "top5"))}`,
    `Printing  top-1 ${formatPercent(rate(report.printing, "top1"))}  top-5 ${formatPercent(rate(report.printing, "top5"))}`,
    `  unique art  top-1 ${formatPercent(rate(report.printingUniqueArt, "top1"))} (n=${String(report.printingUniqueArt.count)})`,
    `  shared art  top-1 ${formatPercent(rate(report.printingSharedArt, "top1"))} (n=${String(report.printingSharedArt.count)})`,
    "",
    `Escalation past T1: ${formatPercent(report.escalationRate)}`,
  ];

  for (const tier of TIERS) {
    const latency = report.latencyByTier[tier];
    if (latency.count === 0) continue;
    lines.push(
      `  ${tier}  ${formatPercent(report.tierShare[tier])} of images  p50 ${String(latency.p50)}ms  p95 ${String(latency.p95)}ms`,
    );
  }

  return lines.join("\n");
}
