import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";
import { baseConfig } from "../../eslint.config.base.mjs";

export default defineConfig([
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "src/db/migrations/**"]),
  ...baseConfig(import.meta.dirname),
  ...nextVitals,
  ...nextTs,
  reactHooks.configs.flat["recommended-latest"],
]);
