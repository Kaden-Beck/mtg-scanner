import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Baseline, baselineSchema, buildBaseline } from "./baseline.ts";
import { type CorpusManifest, corpusManifestSchema } from "./manifest.ts";
import type { Candidate, RecognitionResult, Report, Tier } from "./metrics.ts";
import { buildReport } from "./metrics.ts";

/**
 * The corpus accuracy harness (KAD-37).
 *
 * **Offline by construction.** Nothing here fetches: it reads local files and
 * calls a recognizer that was handed to it. That is a stronger guarantee than
 * a test asserting `fetch` was not called, and it is deliberate - an accuracy
 * number that depends on Scryfall being up is not a regression gate, it is a
 * flaky test that occasionally comments on accuracy.
 *
 * The recognizer is a parameter rather than an import because none exists
 * yet: T0 is KAD-39, T1 KAD-40, T2 KAD-44, T3 KAD-51, T4 KAD-47. Fixing the
 * measurement before the thing being measured is the entire point of building
 * the corpus first, so this file is written to be plugged into rather than
 * changed.
 */

export interface RecognizerOutput {
  candidates: Candidate[];
  tier: Tier;
}

/** Given an absolute path to a photograph, return ranked candidates. */
export type Recognizer = (imagePath: string) => Promise<RecognizerOutput>;

export interface HarnessRun {
  results: RecognitionResult[];
  /** Images the recognizer threw on. Kept rather than swallowed: a crash is
   *  a failure mode worth seeing, and these land in the report's `missing`
   *  count so they cannot flatter the accuracy number. */
  errors: { image: string; message: string }[];
}

/**
 * Runs the recognizer over every entry, timing each call.
 *
 * The harness does the timing rather than trusting the recognizer to
 * self-report, so latency is measured the same way for every tier and cannot
 * quietly exclude a tier's own setup cost.
 *
 * Sequential, not parallel: these numbers feed M3 (≤2.0s median per card),
 * and running eight at once on a multi-core box would measure throughput
 * while claiming to measure latency.
 */
export async function runHarness(
  manifest: CorpusManifest,
  recognize: Recognizer,
  imageDir: string,
): Promise<HarnessRun> {
  const results: RecognitionResult[] = [];
  const errors: HarnessRun["errors"] = [];

  for (const entry of manifest.entries) {
    const started = performance.now();
    try {
      const output = await recognize(join(imageDir, entry.image));
      results.push({
        image: entry.image,
        candidates: output.candidates,
        tier: output.tier,
        latencyMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      errors.push({
        image: entry.image,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { results, errors };
}

export function loadManifest(corpusDir: string): CorpusManifest {
  const raw = readFileSync(join(corpusDir, "labels.json"), "utf8");
  return corpusManifestSchema.parse(JSON.parse(raw));
}

/**
 * The recorded baseline, or null when none has been taken yet.
 *
 * Null rather than a throw for a *missing* file: the first run legitimately
 * has nothing to compare against, and that is not an error. A file that
 * exists but does not parse *does* throw - a hand-edited baseline missing a
 * metric would otherwise compare `undefined`, make every delta NaN, and leave
 * the gate silently passing forever.
 */
export function loadBaseline(corpusDir: string): Baseline | null {
  let raw: string;
  try {
    raw = readFileSync(join(corpusDir, "baseline.json"), "utf8");
  } catch {
    return null;
  }
  return baselineSchema.parse(JSON.parse(raw));
}

export function writeBaseline(corpusDir: string, baseline: Baseline): void {
  writeFileSync(join(corpusDir, "baseline.json"), `${JSON.stringify(baseline, null, 2)}\n`);
}

export interface EvaluateOptions {
  corpusDir: string;
  imageDir?: string;
  recognize: Recognizer;
}

export interface Evaluation {
  report: Report;
  run: HarnessRun;
  manifest: CorpusManifest;
}

export async function evaluate(options: EvaluateOptions): Promise<Evaluation> {
  const manifest = loadManifest(options.corpusDir);
  const run = await runHarness(manifest, options.recognize, options.imageDir ?? options.corpusDir);
  return { report: buildReport(manifest.entries, run.results), run, manifest };
}

export { buildBaseline };
