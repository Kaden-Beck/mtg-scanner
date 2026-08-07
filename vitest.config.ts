import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Two environments, one runner, split by extension: `.test.ts` is pure logic
// (query parser, pHash math, import mappers, schema validation, formatting
// helpers) and runs under plain Node; `.test.tsx` renders React and needs a
// DOM. See ADR-007 for why Vitest over ts-jest.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Root-only option (not valid on project configs). RSC-heavy pages
    // (ADR-007) currently have no client-side islands to unit test —
    // Playwright covers them. Fails loudly again the moment a
    // jsdom-matching test file exists but doesn't run.
    passWithNoTests: true,
    projects: [
      {
        resolve: {
          tsconfigPaths: true,
        },
        test: {
          name: "node",
          environment: "node",
          include: ["{apps,packages}/*/src/**/*.test.ts"],
        },
      },
      {
        resolve: {
          tsconfigPaths: true,
        },
        plugins: [react()],
        test: {
          name: "jsdom",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["apps/web/src/**/*.test.tsx"],
        },
      },
      {
        resolve: {
          tsconfigPaths: true,
        },
        test: {
          // The NFR-1 search benchmark (KAD-20). Its own project, and named
          // `.bench.ts` rather than `.test.ts`, so seeding 110k rows can't
          // wander into the default suite: `pnpm test` names the projects it
          // wants, and `pnpm test:perf` is the only way in here.
          name: "perf",
          environment: "node",
          include: ["apps/web/src/**/*.bench.ts"],
          // Wall-clock at 110k rows; the default 5s timeout is not close.
          testTimeout: 600_000,
          hookTimeout: 600_000,
        },
      },
    ],
  },
});
