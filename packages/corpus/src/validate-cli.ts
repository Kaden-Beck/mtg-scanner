import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Explicit `.ts` extensions: Node's ESM loader under
// `--experimental-strip-types` does not do TypeScript's extensionless
// resolution, so an extensionless specifier typechecks fine and then fails
// at runtime with ERR_MODULE_NOT_FOUND. It bites transitively too: the whole
// import graph reachable from a CLI needs the extension, not just this line.
// Same trap as `db/restore-cli.ts`.
import { corpusManifestSchema, strataCounts, validateManifest } from "./manifest.ts";

/**
 * `pnpm corpus:validate` (KAD-36).
 *
 * Checks the corpus manifest and prints a coverage table. Exits non-zero on
 * any problem, so it can gate a commit as well as inform a shoot in progress.
 *
 * Reports *every* problem in one pass rather than stopping at the first:
 * fixing a corpus one error per run means re-photographing cards one error
 * per run.
 */

const CORPUS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "tests",
  "corpus",
);

function main(): void {
  const path = process.argv[2] ?? join(CORPUS_DIR, "labels.json");

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    console.error(`No manifest at ${path}`);
    console.error("Copy tests/corpus/labels.example.json to labels.json to start.");
    process.exit(1);
  }

  const parsed = corpusManifestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error(`${path} is not a valid corpus manifest:\n`);
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  const manifest = parsed.data;
  console.log(`${path}: ${String(manifest.entries.length)} entries\n`);

  for (const [axis, counts] of Object.entries(strataCounts(manifest))) {
    const summary = Object.entries(counts)
      .map(([value, count]) => `${value}=${String(count)}`)
      .join("  ");
    console.log(`  ${axis.padEnd(11)} ${summary}`);
  }

  const problems = validateManifest(manifest);
  if (problems.length === 0) {
    console.log("\nCorpus is valid.");
    return;
  }

  console.error(`\n${String(problems.length)} problem(s):`);
  for (const problem of problems) {
    const where = problem.index >= 0 ? `entry ${String(problem.index)}` : "corpus";
    console.error(`  ${where}: ${problem.message}`);
  }
  process.exit(1);
}

main();
