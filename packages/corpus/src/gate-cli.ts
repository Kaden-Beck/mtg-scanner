import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Explicit `.ts` extensions - Node's ESM loader under
// `--experimental-strip-types` does not do extensionless resolution.
import { compareToBaseline, formatGateResult } from "./baseline.ts";
import { evaluate, loadBaseline } from "./harness.ts";
import { formatReport } from "./metrics.ts";
import { activeRecognizer } from "./recognizer-registry.ts";

/**
 * `pnpm corpus:gate` (KAD-37).
 *
 * Runs the corpus, prints the accuracy report, and fails when any gated
 * metric has dropped more than one percentage point below the recorded
 * baseline.
 *
 * Exits 0 with an explanation when there is nothing to measure - no
 * recognizer yet, or no baseline yet. A gate that cannot run should say so
 * rather than either failing the build for a reason nobody can act on, or
 * passing silently as if it had checked something.
 */

const CORPUS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "tests",
  "corpus",
);

async function main(): Promise<void> {
  const recognize = activeRecognizer();
  if (!recognize) {
    console.log("No recognizer registered yet (see recognizer-registry.ts; T1 lands in KAD-40).");
    console.log("Nothing to measure - skipping the accuracy gate.");
    return;
  }

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
