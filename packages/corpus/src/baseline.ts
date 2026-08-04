import { z } from "zod";
import { formatPercent, type Report, rate } from "./metrics.ts";

/**
 * The CI regression gate (KAD-37).
 *
 * Accuracy must not fall more than one percentage point below the recorded
 * baseline. Unlike the NFR-1 search benchmark - which reports but never fails
 * a build, because wall-clock on a shared runner is too noisy to gate on -
 * this *does* gate: accuracy is deterministic given the same corpus and the
 * same code, so a drop is a real regression rather than a busy neighbour.
 *
 * Latency is the exception and is deliberately **not** gated, for exactly the
 * NFR-1 reason. It is reported so a change that doubles runtime is visible,
 * but a slow runner must not turn a correct change red.
 */

/** The gated metrics, as a tuple so they can be iterated without asserting
 *  `Object.keys`'s `string[]` back into a narrower key type. */
export const GATED_METRICS = ["oracleTop1", "oracleTop5", "printingTop1", "printingTop5"] as const;
export type GatedMetric = (typeof GATED_METRICS)[number];

/**
 * Validated rather than cast on read.
 *
 * `baseline.json` is a file on disk that a person can hand-edit, and a
 * missing metric read through a cast is `undefined` - which makes `before -
 * after` NaN, and `NaN > tolerance` false. The gate would pass silently
 * forever. Parsing is the difference between a loud failure and a dead gate.
 */
export const baselineSchema = z.object({
  version: z.literal(1),
  recordedAt: z.string(),
  commit: z.string(),
  corpusSize: z.number().int().nonnegative(),
  metrics: z.object({
    oracleTop1: z.number(),
    oracleTop5: z.number(),
    printingTop1: z.number(),
    printingTop5: z.number(),
  }),
});

export type Baseline = z.infer<typeof baselineSchema>;

/** One percentage point, as a fraction. The AC's tolerance. */
export const REGRESSION_TOLERANCE = 0.01;

/**
 * The AC says "not regress *more than* 1pp", so a drop of exactly one point
 * has to pass - and in floats it does not: `0.95 - 0.94` is
 * `0.010000000000000009`, which is greater than `0.01`. Comparing at
 * micro-point resolution keeps the boundary case on the correct side without
 * loosening the gate by anything a real regression could hide in.
 */
function exceedsTolerance(drop: number): boolean {
  const SCALE = 1e6;
  return Math.round(drop * SCALE) > Math.round(REGRESSION_TOLERANCE * SCALE);
}

export interface GateFailure {
  metric: GatedMetric;
  baseline: number;
  current: number;
  /** How far below tolerance, as a fraction. Always > 0. */
  droppedBy: number;
}

export interface GateResult {
  passed: boolean;
  failures: GateFailure[];
  /** Improvements and tolerable drops, for the log. */
  deltas: { metric: GatedMetric; baseline: number; current: number }[];
  /** Set when the comparison itself is untrustworthy - a corpus that has
   *  changed size makes every metric incomparable, and passing quietly would
   *  be worse than failing loudly. */
  warning?: string;
}

export function metricsFromReport(report: Report): Record<GatedMetric, number> {
  return {
    oracleTop1: rate(report.oracle, "top1"),
    oracleTop5: rate(report.oracle, "top5"),
    printingTop1: rate(report.printing, "top1"),
    printingTop5: rate(report.printing, "top5"),
  };
}

export function compareToBaseline(baseline: Baseline, report: Report): GateResult {
  const current = metricsFromReport(report);
  const failures: GateFailure[] = [];
  const deltas: GateResult["deltas"] = [];

  for (const metric of GATED_METRICS) {
    const before = baseline.metrics[metric];
    const after = current[metric];
    deltas.push({ metric, baseline: before, current: after });

    const drop = before - after;
    if (exceedsTolerance(drop)) {
      failures.push({ metric, baseline: before, current: after, droppedBy: drop });
    }
  }

  const result: GateResult = { passed: failures.length === 0, failures, deltas };

  // A corpus that grew is the normal case as photos are added, and the
  // comparison is still directionally useful - but it is not apples to
  // apples, and saying so is cheaper than someone eventually discovering it
  // during a confusing debugging session.
  if (baseline.corpusSize !== report.evaluated) {
    result.warning =
      `baseline was recorded against ${String(baseline.corpusSize)} images, ` +
      `this run evaluated ${String(report.evaluated)}; metrics are not strictly comparable`;
  }

  return result;
}

export function formatGateResult(result: GateResult): string {
  const lines: string[] = [];

  if (result.warning) lines.push(`WARNING: ${result.warning}`, "");

  for (const delta of result.deltas) {
    const change = delta.current - delta.baseline;
    const sign = change >= 0 ? "+" : "";
    lines.push(
      `${delta.metric.padEnd(14)} ${formatPercent(delta.baseline)} -> ${formatPercent(delta.current)} (${sign}${formatPercent(change)})`,
    );
  }

  if (result.failures.length > 0) {
    lines.push("", "REGRESSED beyond the 1pp tolerance:");
    for (const failure of result.failures) {
      lines.push(`  ${failure.metric}: down ${formatPercent(failure.droppedBy)}`);
    }
  }

  return lines.join("\n");
}

export function buildBaseline(report: Report, commit: string, recordedAt: string): Baseline {
  return {
    version: 1,
    recordedAt,
    commit,
    corpusSize: report.evaluated,
    metrics: metricsFromReport(report),
  };
}
