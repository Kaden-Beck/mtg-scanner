import { defineConfig, devices } from "@playwright/test";
import { E2E_DATABASE_PATH } from "./apps/web/e2e/db-path";

export default defineConfig({
  testDir: "./apps/web/e2e",
  /**
   * Files run in parallel; tests *within* a file run serially in one worker.
   *
   * Not a performance concession - a correctness one. `test.beforeAll` runs
   * once per worker, so under `fullyParallel` a single spec file seeded its
   * fixtures ~8 times per run, each with its own nonce. That put ~40 binder
   * locations in the table per run against a `BINDER_FACET_LIMIT` of 50, and
   * two runs inside the stale-fixture GC window pushed the location the
   * KAD-21 facet test clicks off the end of an alphabetically-truncated
   * list. Seeding once per file makes the fixture count a property of the
   * suite rather than of how many cores the runner happens to have.
   */
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm --filter web dev",
    url: "http://localhost:3000",
    // NOTE: with a `next dev` already listening on 3000, Playwright reuses it
    // and this env is *not* applied - that server keeps whatever database it
    // started with. Stop it first if you want the isolated one.
    reuseExistingServer: !process.env.CI,
    env: { DATABASE_PATH: E2E_DATABASE_PATH },
    timeout: 120_000,
  },
});
