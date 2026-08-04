import path from "node:path";

/**
 * The database the e2e dev server runs against.
 *
 * Deliberately *not* `apps/web/data/mtg.db`. The specs seed fixtures straight
 * into SQLite, and pointing them at the working dev database has two bad
 * consequences that took a real failure to surface:
 *
 * 1. `test.beforeAll` runs once **per worker**, not once per run, so a single
 *    `pnpm test:e2e` seeds ~8 independent fixture sets. Two runs inside the
 *    stale-fixture GC window put ~70 distinct binder locations in the table,
 *    and `BINDER_FACET_LIMIT` is 50 - so the facet truncated alphabetically
 *    and the KAD-21 chip the spec clicks fell off the end. The spec was fine;
 *    the shared, accumulating database was not.
 * 2. It writes test fixtures into the collection a person is actually using.
 *
 * A dedicated file fixes both. `db/client.ts` migrates on first connection, so
 * this needs no setup beyond existing - and the parent directory is created by
 * the same code that already has to do it for `mtg.db`.
 *
 * Resolved from `process.cwd()` rather than `import.meta.dirname`: Playwright
 * transpiles specs to CJS, where `import.meta` is a hard SyntaxError at load
 * time, and both the config and the specs import this module. `playwright
 * test` runs from the repo root, the same assumption the config's relative
 * `testDir` already makes.
 *
 * Absolute, because the dev server's own cwd is `apps/web` rather than the
 * repo root.
 */
export const E2E_DATABASE_PATH =
  process.env["DATABASE_PATH"] ?? path.join(process.cwd(), "apps", "web", "data", "e2e.db");
