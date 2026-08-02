# ADR-006: TypeScript 6.x as source of truth, tsgo as a non-blocking checker

## Status

Accepted (2026-08).

## Context

TypeScript 7.0 went GA on 2026-07-08 with a Go-ported compiler that is 8-12x
faster than the 6.x (`tsc`) implementation. That speed matters here: type-aware
ESLint runs `tsc` under the hood, and this project's linting is deliberately
strict (`strictTypeChecked`), so compiler speed is on the critical path for
every commit.

7.0 does not ship a stable *programmatic* API, only the CLI. `typescript-eslint`
closed its "support TS7" request as *not planned* on exactly that basis, and
ESLint core's type-aware rules are blocked behind the same gap. ts-jest has
the identical dependency, which independently rules it out (see ADR-007).

## Decision

- `typescript@6.0.3` is the source of truth for emit, `tsc --noEmit` type
  checking, and everything `typescript-eslint` does.
- `@typescript/native-preview` (`tsgo`) runs alongside as a **non-blocking**
  CI job and an optional fast editor check. It is not permitted to fail a
  build.
- Revisit at TypeScript 7.1 (~October 2026), when a stable programmatic API
  is expected to land and `typescript-eslint` support becomes possible.

## Consequences

- Every package gets two scripts: `typecheck` (`tsc --noEmit`, blocking) and
  `typecheck:tsgo` (`tsgo --noEmit`, informational).
- CI runs both; only `typecheck` gates merges.
- When 7.1 lands with programmatic API support, flip the source of truth and
  drop the dual-tracking — tracked as a follow-up, not scheduled yet.
