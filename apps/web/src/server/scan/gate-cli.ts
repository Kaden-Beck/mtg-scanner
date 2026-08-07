import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareToBaseline,
  evaluate,
  formatGateResult,
  formatReport,
  loadBaseline,
} from "@mtg/corpus";
import { createOcrRecognizer } from "./ocr-recognizer.ts";

/**
 * `pnpm corpus:gate` — OCR-primary recognizer + KAD-37 harness (ADR-008).
 *
 * Lives in apps/web so the recognizer can use sharp and the local SQLite
 * `cards` table without pulling those into packages/corpus.
 */

const CORPUS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
  "tests",
  "corpus",
);

async function main(): Promise<void> {
  if (!existsSync(resolve(CORPUS_DIR, "labels.json"))) {
    console.log("No tests/corpus/labels.json yet - nothing to measure.");
    console.log("Label the corpus (pnpm corpus:label / corpus:from-manabox) first.");
    return;
  }

  const recognize = createOcrRecognizer();
  const { report } = await evaluate({ corpusDir: CORPUS_DIR, recognize });
  console.log(formatReport(report));
  console.log("");

  const baseline = loadBaseline(CORPUS_DIR);
  if (!baseline) {
    console.log("No baseline recorded yet - nothing to regress against.");
    console.log("Write tests/corpus/baseline.json from this run to start gating.");
    return;
  }

  const result = compareToBaseline(baseline, report);
  console.log(formatGateResult(result));

  if (!result.passed) {
    console.error("\nAccuracy regressed beyond the 1 percentage point tolerance.");
    process.exit(1);
  }
}

await main();
