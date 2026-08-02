import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Two environments, one runner: pure logic (query parser, pHash math, import
// mappers, schema validation) runs under plain Node; anything that renders
// React needs a DOM. See ADR-007 for why Vitest over ts-jest.
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
          include: [
            "packages/**/src/**/*.test.ts",
            "apps/worker/src/**/*.test.ts",
            "apps/web/src/server/**/*.test.ts",
          ],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "jsdom",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["apps/web/src/**/*.test.tsx"],
        },
      },
    ],
  },
});
