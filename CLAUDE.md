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
