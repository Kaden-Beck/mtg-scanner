---
name: verify-clean
description: Run the full local quality gate (ESLint, Biome, typecheck, and relevant tests) before claiming a change is clean. Use when the user asks to verify, pretends CI, or says a commit/PR is ready.
---

# Verify clean

CI runs **both** linters plus typecheck and tests. A green `pnpm lint` alone is not enough.

## Checklist

Copy and tick:

```
Verify:
- [ ] pnpm lint
- [ ] pnpm lint:biome
- [ ] pnpm typecheck
- [ ] pnpm test   (or narrower vitest path if scoped)
- [ ] Adjacent runtime check if touching Next/DB/Docker (see below)
```

## How to run

Prefer the long-lived `mtg-dev` container when host Node is unavailable — see the `dev-container` skill.

```sh
pnpm lint
pnpm lint:biome
pnpm typecheck
pnpm test
```

Scoped unit tests:

```sh
pnpm exec vitest run --project node path/to/file.test.ts
```

E2E only when UI/routes changed:

```sh
pnpm test:e2e
```

## Runtime re-checks (not covered by unit tests)

If the change touches Next SSR, SQLite client, migrations, Dockerfile, or ingest:

- `pnpm --filter web build` (or `next build` in the web app)
- and/or `podman compose up --build` / `docker compose up --build`

See `.cursor/rules/nextjs-footguns.mdc` and `CLAUDE.md`.

## Done criteria

Only call the work "clean" or "ready to commit" when every applicable box above is green. If something failed, fix it and re-run that step — don't skip Biome because ESLint passed.
