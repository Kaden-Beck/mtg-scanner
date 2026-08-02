# ADR-007: Vitest over ts-jest

## Status

Accepted (2026-08).

## Context

Most of this project's test surface is pure logic: the Scryfall query
parser, pHash math, legality rules, CSV import mappers, Zod boundary
validation. A smaller surface is React UI (collection browse, deck editor,
sync status page).

`packages/phash` (KAD-25) must run isomorphically in both the browser and
Node, since segmentation/hashing needs to move between client and server
without a rewrite.

`ts-jest` and `typescript-eslint` share the same blocker: both depend on
TypeScript's programmatic API, which TS 7.0 does not ship (see ADR-006).
ts-jest's TS transform is also the dominant cost in its watch-mode loop,
which matters for a solo-dev feedback cycle.

## Decision

Vitest for all unit and component tests, configured with two environments
(one `vitest.config.ts` at the repo root, `test.projects`):

- `node` — pure logic: `packages/**`, `apps/worker/**`, `apps/web/src/server/**`.
- `jsdom` — anything that renders React: `apps/web/src/**/*.test.tsx`.

Playwright covers real end-to-end browser flows and is the tool of record
for anything Vitest's `jsdom` environment can't represent faithfully.

**Known gap, accepted:** Vitest cannot render async React Server Components.
RSC-heavy surfaces (collection browse, deck editor) are covered by Playwright
E2E instead of component tests. Revisit only if unit-level RSC testing
becomes necessary — not expected before R2.

## Consequences

- ESM-native config works cleanly for `packages/schemas` and `packages/phash`,
  shared unchanged between `apps/web` and `apps/worker`.
- One test runner, two environments, instead of two runners (unit vs. RSC).
- Type checking for tests is `tsc`'s job (via `typecheck`), not Vitest's —
  Vitest is not exposed to the same TS7 programmatic-API gap that blocks
  ts-jest.
