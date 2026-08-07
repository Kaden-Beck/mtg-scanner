import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

/**
 * Shared across every workspace package. `strictTypeChecked` (not
 * `recommended`) per ADR-006 — this domain is full of near-identical string
 * ids and discriminated unions where the stricter rule set (floating
 * promises, misused promises, unnecessary conditions) earns its keep.
 *
 * `consistent-type-assertions: never` bans `as SomeType` casts in domain
 * code. Branded ids and Zod-inferred types come from `.parse()`, never from
 * assertion — see packages/schemas. Tests are exempt: mocking sometimes
 * needs a cast and tests aren't domain code.
 */
export function baseConfig(tsconfigRootDir) {
  return defineConfig(
    // Config files (eslint.config.mjs, postcss.config.mjs, ...) aren't part
    // of any tsconfig project and don't need type-aware linting.
    { ignores: ["*.config.mjs", "*.config.cjs"] },
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      rules: {
        "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
        "@typescript-eslint/no-unused-vars": [
          "error",
          {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            destructuredArrayIgnorePattern: "^_",
          },
        ],
      },
    },
    {
      files: ["**/*.test.ts", "**/*.test.tsx", "**/*.config.{ts,mts,mjs}"],
      rules: {
        "@typescript-eslint/consistent-type-assertions": "off",
      },
    },
  );
}
