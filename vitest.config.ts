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
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["{apps,packages}/*/src/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "jsdom",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["apps/web/src/**/*.test.tsx"],
          // RSC-heavy pages (ADR-007) currently have no client-side islands
          // to unit test - Playwright covers them. Fails loudly again the
          // moment a jsdom-matching test file exists but doesn't run.
          passWithNoTests: true,
        },
      },
    ],
  },
});
