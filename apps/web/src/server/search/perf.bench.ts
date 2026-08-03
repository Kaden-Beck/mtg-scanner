import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

/**
 * NFR-1 benchmark: search p95 <= 200ms at 110k printings / 20k owned
 * stacks (KAD-20).
 *
 * Deliberately NOT matched by the default `pnpm test` glob - seeding
 * 110k rows takes far too long to sit in the normal suite. Run it with
 * `pnpm test:perf`, which is the only entry point: this file is named
 * `.bench.ts` and lives in its own Vitest project, so the default suite
 * cannot glob it up. Follows the CLAUDE.md convention for expensive,
 * non-mocked runs.
 *
 * Reports rather than gates. Per the ticket, p95 is a *tracked metric*,
 * not a hard gate yet: failing a build on wall-clock timing measured on
 * whatever machine CI happened to schedule is a flaky-test factory. The
 * threshold is asserted only as a warning line in the output, and the one
 * hard assertion is on correctness (every query returns rows), so the
 * benchmark can still catch a compiler change that silently breaks the
 * queries it's timing.
 */

const P95_TARGET_MS = 200;
const ITERATIONS = 20;
const WARMUP_ITERATIONS = 3;

let dir: string;
let runCollectionSearch: typeof import("./collection-search")["runCollectionSearch"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mtg-perf-"));
  process.env["DATABASE_PATH"] = join(dir, "perf.db");
  process.env["DRIZZLE_MIGRATIONS_FOLDER"] = join(import.meta.dirname, "../../../drizzle");

  const { db } = await import("../db/client");
  const { seedPerfFixture } = await import("./perf-fixture");

  const seedStart = performance.now();
  const counts = seedPerfFixture(db);
  const seedMs = performance.now() - seedStart;
  console.log(
    `seeded ${counts.cards.toLocaleString()} cards / ` +
      `${counts.collectionItems.toLocaleString()} collection items / ` +
      `${counts.tags.toLocaleString()} tags in ${(seedMs / 1000).toFixed(1)}s`,
  );

  ({ runCollectionSearch } = await import("./collection-search"));
}, 600_000);

afterAll(() => {
  globalThis.__mtgSqlite?.close();
  globalThis.__mtgSqlite = undefined;
  globalThis.__mtgDb = undefined;
  rmSync(dir, { recursive: true, force: true });
  delete process.env["DATABASE_PATH"];
  delete process.env["DRIZZLE_MIGRATIONS_FOLDER"];
});

/** Representative of what the browse UI actually issues. */
const QUERIES: readonly { readonly label: string; readonly query: string }[] = [
  { label: "bare name (LIKE)", query: "Perf Card 0001" },
  { label: "single color", query: "c:r" },
  { label: "color subset (<=)", query: "c<=rg" },
  { label: "color superset (>=)", query: "c>=rg" },
  { label: "exact colors (=)", query: "c=wubrg" },
  { label: "type LIKE", query: "t:creature" },
  { label: "oracle LIKE", query: "o:draw" },
  { label: "numeric compare", query: "cmc<=3" },
  { label: "set equality", query: "set:p01" },
  { label: "rarity equality", query: "r:mythic" },
  { label: "is: json_each", query: "is:foil" },
  { label: "binder LIKE (joined)", query: "binder:box1" },
  { label: "condition (joined)", query: "condition:nm" },
  { label: "tag EXISTS (joined)", query: "tag:cube" },
  { label: "tag quoted value", query: 'tag:"edh staple"' },
  { label: "tag negated", query: "-tag:cube" },
  { label: "tag + card predicate", query: "tag:cube c:r t:creature" },
  { label: "multi-operator AND", query: "c:r t:creature cmc<=3 r:common" },
  { label: "OR", query: "c:r OR c:u" },
  { label: "negation", query: "t:creature -is:reserved" },
  { label: "nested parens", query: "(c:r OR c:g) t:creature -r:common" },
];

function percentile(sorted: readonly number[], p: number): number {
  // Nearest-rank: with 20 samples the p95 is the 19th, which is what we
  // want - no interpolation inventing a value between two measurements.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1] ?? 0;
}

interface Measurement {
  readonly label: string;
  readonly query: string;
  readonly rows: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

it("reports p50/p95 for representative collection searches (NFR-1)", () => {
  const results: Measurement[] = [];

  for (const { label, query } of QUERIES) {
    for (let i = 0; i < WARMUP_ITERATIONS; i++) runCollectionSearch(query);

    const samples: number[] = [];
    let rows = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      const outcome = runCollectionSearch(query);
      samples.push(performance.now() - start);
      // A query that stopped compiling would otherwise benchmark as
      // gloriously fast. Correctness is the one hard assertion here.
      expect(outcome.ok, `${label} (${query}) failed to run`).toBe(true);
      if (outcome.ok) rows = outcome.rows.length;
    }

    samples.sort((a, b) => a - b);
    results.push({
      label,
      query,
      rows,
      p50: percentile(samples, 50),
      p95: percentile(samples, 95),
      max: samples[samples.length - 1] ?? 0,
    });
  }

  console.table(
    results.map((r) => ({
      query: r.query,
      rows: r.rows,
      "p50 (ms)": r.p50.toFixed(1),
      "p95 (ms)": r.p95.toFixed(1),
      "max (ms)": r.max.toFixed(1),
      "NFR-1": r.p95 <= P95_TARGET_MS ? "ok" : "OVER",
    })),
  );

  const worst = results.reduce((a, b) => (a.p95 >= b.p95 ? a : b));
  const over = results.filter((r) => r.p95 > P95_TARGET_MS);
  console.log(
    `worst p95: ${worst.p95.toFixed(1)}ms (${worst.query}) - ` +
      `NFR-1 target ${String(P95_TARGET_MS)}ms, ${String(over.length)}/${String(results.length)} over`,
  );
  if (over.length > 0) {
    console.warn(
      `NFR-1 NOT MET for: ${over.map((r) => `${r.query} (${r.p95.toFixed(1)}ms)`).join(", ")}`,
    );
  }

  // Tracked, not gated - see the file header.
  expect(results).toHaveLength(QUERIES.length);
}, 600_000);
