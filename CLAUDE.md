# CLAUDE.md

Project-specific context for working in this repo. See also `docs/adr/` for
why the toolchain is shaped the way it is, and the Linear project
(MTG App) for the sprint plan, working agreements, and acceptance criteria.

## Environment

- **No Node.js on the host** (immutable Fedora-family system). All
  node/npm/pnpm work happens inside a container. Pattern used throughout
  Sprint 1:

  ```sh
  podman run -d --name mtg-dev -v "$(pwd)":/workspace:Z -w /workspace node:22 sleep infinity
  podman exec mtg-dev sh -c "cd /workspace && <command>"
  ```
  
  A single long-lived container (not a fresh one per command) avoids
  re-pulling/re-initializing on every invocation.
- pnpm workspace; `corepack enable` provisions the pinned pnpm version.
  `pnpm install` puts its content-addressable store at `.pnpm-store/` inside
  the repo (gitignored) unless configured otherwise.
- Docker and Podman are both available; `podman compose` shells out to the
  `docker-compose` plugin. Use this for anything touching `Dockerfile` /
  `docker-compose.yml` — building and actually running the container is the
  only way some bugs surface (see below).

## Real bugs only found by running things, not just testing

Mocked/unit tests did not catch these. If you're touching adjacent code,
re-verify by actually running it (`next build`, `next dev`, `docker compose
up --build`), not just `pnpm test`.

- **Next 16 + Turbopack: `import.meta.dirname` is `undefined` inside the SSR
  bundle.** Works fine under Vitest (vite-node) and plain Node, silently
  breaks under `next dev`/`next build`. Use `process.cwd()`-based paths in
  app runtime code instead — Next.js guarantees cwd is the app directory.
  (`apps/web/src/server/db/client.ts`)
- **Next 16 Cache Components silently prerender synchronous DB reads.**
  better-sqlite3 is sync, so a page/route reading it has no signal to Next
  that it needs per-request rendering — it gets baked into the static build
  output once, permanently. Call `await connection()` from `next/server`
  before the read. Check `next build` output: a live-data route must show
  `ƒ Dynamic`, not `○ Static`. (`apps/web/src/server/sync/status.ts`)
- **better-sqlite3 doesn't create the DB file's parent directory.** `mkdir
  -p` it before `new Database(path)`, both in the app's db client and any
  standalone script that opens the DB.
- **SQLite has a bound-parameter limit per statement.** A batch upsert of
  1000 rows × ~36 columns blew past it ("too many SQL variables") on a real
  ingest run; 2-row mocked tests never would have caught it. Batch size for
  `cards` is 200 with headroom — if the schema grows, re-check this.
  (`apps/web/src/server/ingest/bulk-cards.ts`)
- **Scryfall's `/bulk-data` API now only serves gzip-compressed JSONL** via
  `jsonl_download_uri` (no plain-JSON `download_uri` — that's stale docs).
  The set code field is `set`, not `set_code`. Confirmed against the live
  API 2026-08-02; re-verify if this ever breaks, don't assume.
- **pnpm workspace symlinks are relative and path-sensitive.** Dockerizing
  requires copying `node_modules` (root), `packages/`, and `apps/web` into
  the final image at the *exact same relative paths* they had in the build
  stage, or the symlinks (`apps/web/node_modules/@mtg/schemas -> ../../
  packages/schemas`, etc.) point nowhere. (`Dockerfile`)
- **Biome's `useLiteralKeys` and the `noPropertyAccessFromIndexSignature`
  tsconfig flag disagree** about `process.env.X` vs `process.env["X"]`.
  Biome's rule is disabled in `biome.jsonc`; the tsconfig flag wins.
- **`eslint-plugin-react-hooks` 7.x flat config is at
  `configs.flat["recommended-latest"]`**, not `configs["recommended-latest"]`
  (that's the legacy eslintrc-format export and errors under flat config).
- **`node --experimental-strip-types` needs explicit `.ts` extensions on
  relative imports.** Unlike `tsc`/Vitest's `moduleResolution: "bundler"`,
  Node's ESM loader doesn't do TS-style extensionless resolution —
  `import { x } from "../y"` fails with `ERR_MODULE_NOT_FOUND` at runtime
  even though it typechecks fine. Only bites standalone scripts that have
  relative imports at all (`migrate.ts` never hit this — zero relative
  imports). Fix is `allowImportingTsExtensions: true` in tsconfig (safe
  when `noEmit` is already true) plus the `.ts` suffix in the import
  itself, not duplicating the logic to dodge it. (`apps/web/src/server/db/
  restore-cli.ts`)
- **`next/server`'s `connection()` throws outside a real Next request
  scope**, so a route handler that calls it (to opt out of Cache Components
  prerendering, same as the `import.meta.dirname` entry above) can't be
  unit-tested by directly invoking the exported `GET`/etc. function the way
  a plain `POST`/`PATCH`/`DELETE` handler can — Playwright or a real
  `next build`/`next start` is the only way to exercise that specific line.
  Keep `connection()` calls in the thinnest possible wrapper and
  contract-test the logic underneath it directly instead.
- **`zod`'s `z.uuid()` enforces the actual version/variant nibbles**, not
  just "looks like a UUID" — a placeholder like
  `11111111-1111-1111-1111-111111111111` fails validation (`1` isn't a
  legal variant nibble) while a `cards.id` plain-text column happily
  accepts it. Only surfaces once a value crosses a schema boundary that
  actually validates it; use a real `crypto.randomUUID()`-shaped fixture
  instead of a memorable repeated-digit one in tests.
- **Playwright tests need to actually run, not just exist.** Two real bugs
  only surfaced by installing Chromium and running `pnpm test:e2e` for
  real: an existing test assumed there was exactly one "Sync now" button
  (broke once Prices got its own), and a new test wasn't idempotent against
  re-runs because the dev server's DB persists between runs and one story's
  duplicate-file detection hashed the fixture's fixed content. Vitest alone
  would never have caught either.
- **A `sqliteTable()` foreign key needs its parent row to exist before any
  child-row insert, including mid-loop within the same function** — not
  just "before the function returns." A batch-import job that built up
  counts across a loop and only inserted its own summary/parent row
  *after* the loop, while child rows referencing it were inserted *during*
  the loop, hit `FOREIGN KEY constraint failed` immediately. Fix: insert
  the parent row first (with placeholder values), then update it with
  final counts once the loop completes.
- **drizzle-kit's migrator only reads `meta/_journal.json` + the `.sql`
  files to apply migrations — never the snapshot.** The snapshot is only
  used by `db:generate` to compute the *next* diff. This means a
  hand-written migration (e.g. for a SQLite virtual table like FTS5, which
  `sqliteTable()` has no representation for) can be added with just a `.sql`
  file plus a manually-appended journal entry, and it stays completely
  invisible to future `db:generate` runs since those only diff declared
  `schema.ts` tables against the snapshot. (`apps/web/drizzle/0003_cards_fts.sql`)

## Testing conventions

- Vitest projects split by **file extension**, not directory:
  `*.test.ts` → node environment, `*.test.tsx` → jsdom. See ADR-007 for why
  Vitest can't render async Server Components at all — RSC pages are
  covered by Playwright instead, and their pure logic (formatting,
  exhaustive switches) gets extracted into a plain `.test.ts`-testable
  module (e.g. `sync-status-format.ts`) rather than left untestable inside
  the page component.
- `db/client.ts` caches its connection on `globalThis` (survives `next
  dev`'s HMR). Tests that need a fresh DB per test must `vi.resetModules()`
  *and* null out `globalThis.__mtgSqlite`/`__mtgDb`, then re-`await
  import(...)` — resetting only one or the other leaves a stale connection.
  See `bulk-cards.test.ts`.
- For a job that hits a real external API (like the Scryfall ingest), verify
  it for real at least once: a throwaway `.test.ts` file run via `vitest run
  <path>` directly (not matched by the normal `pnpm test` glob until you
  name it that way), never committed. Mocked tests prove the logic; one real
  run proves the integration and catches scale-dependent bugs mocks can't.

## Process

- Git identity and `gh` auth were not configured at the start of this repo
  — both are now set up. The `gh` OAuth token currently **lacks the
  `workflow` scope**, so it can't push changes to `.github/workflows/*`.
  Run `gh auth refresh -s workflow` (device-code flow) to fix; until then,
  workflow file changes need to be pushed some other way or deferred.
- One commit per story, referencing the Linear issue id in the subject line.
  Mark the issue Done and comment with the commit SHA(s) as each lands —
  don't batch this to the end.
- Sprint 1 (R1 · Foundation, all 6 stories) shipped via PR #1, merged
  2026-08-02.
- Sprint 2 (R1 · Foundation, all 6 stories: KAD-12, KAD-10, KAD-11, KAD-13,
  KAD-14, KAD-15) shipped 2026-08-02 via direct commits to `main`, per the
  working agreement's default (no PR unless explicitly asked). 18/18
  committed points landed, none rolled over.
