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
  relative imports — throughout the whole reachable import graph, not just
  the entry file.** Unlike `tsc`/Vitest's `moduleResolution: "bundler"`,
  Node's ESM loader doesn't do TS-style extensionless resolution —
  `import { x } from "../y"` fails with `ERR_MODULE_NOT_FOUND` at runtime
  even though it typechecks fine. Only bites standalone scripts that have
  relative imports at all (`migrate.ts` never hit this — zero relative
  imports). Fix is `allowImportingTsExtensions: true` in tsconfig (safe
  when `noEmit` is already true) plus the `.ts` suffix in the import
  itself, not duplicating the logic to dodge it. (`apps/web/src/server/db/
  restore-cli.ts`) **Sharpened in KAD-37:** `gate-cli.ts` had correct `.ts`
  extensions on all four of its own imports and still died on startup,
  because the modules it imported used extensionless specifiers between
  *themselves*. If a package has a CLI entry point, every relative import in
  that package needs the suffix. Both `tsc` and Vitest stay green either
  way, so running the CLI is the only thing that tells you.
- **A new `packages/*` needs `"types": ["node"]` in its tsconfig to see
  `process` and `node:*`.** Automatic `@types` discovery does not reach a
  workspace package from the root, so `@types/node` in `devDependencies` is
  necessary but not sufficient — the symptom is `Cannot find name 'process'`
  alongside a perfectly present `node_modules/@types/node`.
  (`packages/corpus/tsconfig.json`)
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
- **Playwright specs are transpiled to CJS, where `import.meta` is a hard
  `SyntaxError` at load time** — not a warning, and not something
  typecheck or Vitest will tell you, since both handle it fine. A spec that
  needs a path must use `process.cwd()` (Playwright runs from the repo
  root, the same assumption `playwright.config.ts`'s relative `testDir`
  already makes). (`apps/web/e2e/collection.spec.ts`)
- **Next renders its own `role="alert"` route announcer on every page**
  (`#__next-route-announcer__`), so `getByRole("alert")` is *always*
  ambiguous in a Playwright spec — strict mode fails with two matches even
  when the page has exactly one alert of its own. Give the app's alert an
  explicit `aria-label` and select by name; this is also the better a11y
  outcome, since an unnamed live region is worse for screen readers too.
- **`aria-label` only works on elements whose role supports naming**, which
  a bare `<span>` and `<p>` do not — Biome's `useAriaPropsSupportedByRole`
  catches it, `getByLabel` finds it anyway, and assistive tech ignores it.
  Three shapes solve it, and which one is right depends on the element's
  actual job: a live region that announces gets `role="alert"`/`"status"`
  (the legality report, the card-search selection); standing information
  gets wrapped in a named `<section>`, i.e. a `region` landmark (KAD-32's
  ownership summary); and an inline marker gets *no* `aria-label` at all —
  put the short visual text in `aria-hidden` and the full sentence in a
  `sr-only` sibling (KAD-32's ownership badge, KAD-33's conflict badge).
  The third is usually the right answer for badges, since the terse visual
  form ("2/4", "Also in Yeva") is meaningless read aloud anyway.
- **`next build` runs `migrate()` concurrently in every page-data worker.**
  `db/client.ts` migrates at module evaluation, and Next collects page data
  across ~12 worker *processes* (so the `globalThis` connection cache
  doesn't help) — against an empty `data/`, several race migration 0000 and
  the build dies with ``table `cards` already exists``. Only bites the
  *first* build on a fresh volume, which is exactly the `docker compose up
  --build` path. Tracked as KAD-57; workaround is to build once with an
  already-migrated DB. **Broader than originally recorded (found in
  KAD-24):** it is not only a fresh volume — the first `next build` after
  *any* new migration hits it, because the workers race to apply that
  migration. The second build succeeds. So expect one failed build every
  time you add a migration, and don't go hunting for a new bug.
- **SQLite's default `=` is case-sensitive (BINARY collation), but the
  search compiler normalizes case itself** — `condition:`/`set:`/`r:`
  upper- or lower-case the *query* value before comparing, so the stored
  data has to match the schema's canonical casing (`CONDITIONS` is
  `"NM" | "LP" | ...`, uppercase). A fixture that invents its own lowercase
  literals typechecks only until it crosses `NewCollectionItemRow` — import
  the tuple from `packages/schemas` instead of retyping it.
- **`Math.cos` is not guaranteed bit-identical across JavaScript engines**,
  which makes a bare float `>` unsafe in anything that must agree between
  Node and a browser. `packages/phash` binarizes DCT coefficients against
  their median, and two coefficients equal in exact arithmetic could land on
  opposite sides of it in two engines — so coefficients are quantized to a
  relative grid first, and a featureless image (all ties) answers 0 rather
  than noise. Real artwork is never near a tie, so no meaningful hash
  changed; the bug is invisible until the index and the scanner disagree.
- **`tsc --noEmit` caches in `*.tsbuildinfo`, and a `target` change does not
  invalidate it.** Raising `apps/web` to ES2022 kept reporting the old
  ES2017 BigInt errors until the tsbuildinfo was deleted. If a tsconfig
  change appears to have no effect, delete the cache before believing it.
- **`pnpm lint` is not the lint gate — CI runs `pnpm lint:biome` too.**
  ESLint and Biome are separate steps in `ci.yml` with almost disjoint rule
  sets, so a clean `pnpm lint` says nothing about whether the build passes.
  Sprint 5 pushed red twice before this was noticed. Run **both**, plus
  `pnpm typecheck`, before claiming a commit is clean. Biome catches things
  ESLint does not: import/export ordering (`biome check --write .` fixes
  those mechanically) and, more usefully, real bugs like an `aria-label` on
  a `<p>` — no role that supports naming, so assistive tech ignores it even
  though Playwright's `getByLabel` still finds it.
- **A Playwright `getByRole("button", { name: <card name> })` matches the
  `Remove <card name>` button too.** The deck editor's search suggestions and
  its deck list both carry the card's name, so an unscoped by-name selector
  matched two buttons and the spec "selected" a card by *deleting* it, then
  failed further down looking for a selection that never happened. Give any
  list the user picks from an explicit `aria-label` and scope the locator to
  it. Same family as the "Sync now" ambiguity below - assume any name that
  appears in your data appears in more than one control.
- **A direct `INSERT INTO cards` does not reach `cards_fts`.** The FTS table
  is populated by the ingest (KAD-10), so an e2e fixture seeded straight
  into SQLite is invisible to anything that searches - the deck typeahead
  found nothing until the seed inserted into `cards_fts` explicitly. Hit
  again in KAD-35 in a brand-new spec file: this is a per-spec obligation,
  not something the first fix made global, so any new spec that seeds cards
  and then searches needs its own `insertFts`.
- **Two e2e specs sharing one fixture row makes them order-dependent.**
  KAD-35's "owned-only still offers a claimed card" test created a competing
  deck against the same `collection_items` stack KAD-33's conflict test
  asserted on, so the conflict test's exact list of competing deck names
  gained an extra entry and failed - but only once both specs existed, and
  only in that order. Fixtures that a test *mutates or claims* need to be
  per-test, not per-file; the shared ones should be read-only. Running the
  suite twice back to back is the cheap check, since the fixture GC window
  is an hour.
- **A float subtraction is not safe against a threshold.** KAD-37's gate has
  to pass a drop of *exactly* one percentage point, and `0.95 - 0.94` is
  `0.010000000000000009`, which is greater than `0.01`. Anything comparing a
  computed delta against a tolerance needs to round to a fixed resolution
  first. Same family as the `Math.cos` note above: the bug is invisible
  until the boundary case is the one that matters.
- **`packages/phash` must be the only implementation of resize/grayscale/
  DCT/binarization.** `sharp` (KAD-24) is used for *decode only*, in
  `server/ingest/decode-image.ts`. If the index were built with libvips'
  resampler and a browser scanner used the package's, the two would produce
  different hashes and matching would fail — invisibly, and not until a
  corpus run had already hashed tens of thousands of images wrong.

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
- Expensive suites get their **own Vitest project plus a non-`.test.ts`
  name**, not just a naming convention: the NFR-1 search benchmark is
  `perf.bench.ts` in the `perf` project, and `pnpm test` names the projects
  it wants (`--project node --project jsdom`) so a 110k-row seed cannot be
  globbed into the normal run by accident. `pnpm test:perf` is the only way
  in. (`apps/web/src/server/search/perf.bench.ts`)
- A benchmark **reports, it doesn't gate** — wall-clock on whatever runner
  CI schedules is too noisy to fail a build on. But it must still assert
  *correctness* (every query returns rows), or a change that silently
  breaks the thing being timed will benchmark as gloriously fast.
- **Playwright's `test.beforeAll` runs once per *worker*, not once per run.**
  Under `fullyParallel: true` a spec file that seeds fixtures seeds them ~8
  times, each with its own nonce. That is why the e2e suite now runs
  `fullyParallel: false` (files still parallel; tests within a file
  serialize) and against **its own database**, `apps/web/data/e2e.db`, wired
  through `apps/web/e2e/db-path.ts` and the config's `webServer.env`. Both
  were needed: seeding into the working dev DB accumulated ~70 binder
  locations against `BINDER_FACET_LIMIT`'s 50, so an alphabetically
  truncated facet dropped the chip a test clicked, on the *second* run
  within an hour. Caveat: `reuseExistingServer` means a `next dev` already
  on :3000 keeps its own database and the env is not applied.
- **Vitest 4 removed the `test(name, fn, { timeout })` three-arg form.** It
  throws at collection time with an explicit deprecation error; options go
  in the second argument now.

## Process

- Git identity and `gh` auth were not configured at the start of this repo
  — both are now set up. The `gh` OAuth token lacks the `workflow` scope,
  but **this does not block anything**: `origin` is an SSH remote
  (`git@github.com:...`) and GitHub only enforces the `workflow`-scope
  check on pushes authenticated by an OAuth token, not by an SSH key. An
  earlier note here claimed workflow files couldn't be pushed; that was
  wrong, and `.github/workflows/ci.yml` had in fact been on the remote
  since KAD-20. If you ever switch the remote to HTTPS, the restriction
  becomes real — `gh auth refresh -s workflow` (device-code flow) is the
  fix then.
- One commit per story, referencing the Linear issue id in the subject line.
  Mark the issue Done and comment with the commit SHA(s) as each lands —
  don't batch this to the end.
- **Every deliberate descope, known gap, or deferred cleanup gets a Linear
  ticket with the `Tech Debt` label — not just a commit message and a code
  comment.** A compromise that only exists in prose is invisible at
  planning time. The ticket should say what was left undone, *why* it was
  out of scope, what breaks because of it, and where in the code to look.
  If a test documents the gap (as `color-identity.test.ts` does for
  KAD-58), name that test in the ticket so closing it is obvious.
- Sprint 1 (R1 · Foundation, all 6 stories) shipped via PR #1, merged
  2026-08-02.
- Sprint 2 (R1 · Foundation, all 6 stories: KAD-12, KAD-10, KAD-11, KAD-13,
  KAD-14, KAD-15) shipped 2026-08-02 via direct commits to `main`, per the
  working agreement's default (no PR unless explicitly asked). 18/18
  committed points landed, none rolled over.
- Sprint 3 (R2 · Brewing, all 5 stories: KAD-16 → KAD-20) shipped
  2026-08-03 via direct commits to `main`. 17/17 committed points landed,
  none rolled over. Built the query engine end to end: `packages/query-
  parser` (parser → AST), `server/search/compile.ts` (AST → parameterized
  SQL), the `/collection` browse UI, and the NFR-1 benchmark (worst p95
  41ms against a 200ms target, so the JSON-color-column bitmask redesign
  stays deferred).
- Sprint 4 (R2 · Brewing, all 5 stories: KAD-21 → KAD-25) shipped
  2026-08-03/04 via direct commits to `main`. 17/17 committed points landed,
  none rolled over. Finished collection management (binder locations, tags,
  lossless export/import) and built the recognition pipeline's long pole:
  `packages/phash` plus the artwork hash index job. Two descopes were
  deliberate and recorded on their tickets — KAD-21's AC2 (deck-list
  location display) moved to KAD-32 in Sprint 6 because no decks exist yet,
  and KAD-22's AC1 was already satisfied by KAD-12's stack-uniqueness
  design rather than reworked.
- Sprint 5 (R2 · Brewing, all 5 stories: KAD-26 → KAD-31, excluding the
  KAD-29 duplicate) shipped 2026-08-04 via direct commits to `main`. 17/17
  committed points landed, none rolled over. Built deckbuilding end to end:
  the deck schema and CRUD API, commander color-identity derivation, the
  Commander legality engine, the violation report, and the deck editor UI.
  One deliberate descope, recorded on its ticket: KAD-28 handles Partner /
  Partner with / Friends forever but **not** Backgrounds or Doctor's
  companion, since neither is a keyword lookup on both cards. A test
  documents that gap so it fails loudly when someone closes it.
- Sprint 6 (R2 · Brewing, KAD-32 → KAD-37) shipped 2026-08-04 via direct
  commits to `main`. 17/17 committed points landed. **KAD-36 is the one
  story not fully closed and cannot be**: it needs 300–500 real cards
  photographed, which is a human task. Everything around the photos (the
  manifest schema, validator, capture protocol, and the KAD-37 harness that
  consumes them) shipped; the ticket is In Progress with the handoff on it.
- **Q2 is answered: allocation is advisory** (ADR-004, KAD-34). Over-
  allocation across decks is an expected state, not corruption - there is
  deliberately no constraint summing `deck_allocations.quantity` against
  `collection_items.quantity`. Conflict is detected at *read* time (KAD-33).
  If you arrive intending to add an over-allocation constraint, that is a
  reversal of ADR-004, not a missing guard.
- **Ownership matching is oracle-level, everywhere.** KAD-32's badge,
  KAD-33's allocation and KAD-35's owned-only filter all match on
  `cards.oracle_id`, not `scryfall_id`: in paper any printing of Sol Ring
  plays, so printing-level matching reports cards as unowned while a copy
  sits in the box. The exact printing is tracked alongside so the UI can say
  "owned, different art". Cards with a null `oracle_id` fall back to
  printing-only matching.
- **`deck_allocations` is written only on deck-card mutation** (KAD-33), so a
  deck untouched since Sprint 6 has no rows and a collection edit can leave
  the plan stale in the "user bought another copy" direction.
  `syncAllDeckAllocations()` fixes both in one call and has no caller yet -
  tracked as KAD-61.
- **The recognition accuracy gate is wired but inert.** `pnpm corpus:gate`
  exits 0 explaining that no recognizer is registered; `recognizer-registry
  .ts` returns null until T1 lands (KAD-40), and that is the one function to
  edit. It is deliberately not a stub returning plausible candidates - a
  fake would let a baseline be recorded against nothing. CI runs both the
  corpus validation and the gate behind existence checks so they switch
  themselves on rather than needing a workflow edit.
- **Corpus images are gitignored and that is an open decision**
  (`tests/corpus/.gitignore`). Full-resolution photos are ~1GB; committing
  downscaled copies (1200px, ~60-100MB) is what would let the KAD-37 gate
  run on GitHub-hosted CI, and costs nothing in accuracy since pHash reduces
  to a 32x32 DCT anyway. Decide before the shoot, not after.
- **The dev database now holds a real corpus** - the KAD-8 ingest was run
  during Sprint 5 and `cards` has ~104.7k rows (it had been sitting at 70,
  which made the deck editor undemoable). The ingest takes ~2 minutes.
  Note it can't be run via `node --experimental-strip-types` because
  `bulk-cards.ts` has extensionless relative imports; a throwaway
  `.test.ts` run through `vitest run <path>` is the working route.
- **The hash index has NOT been fully populated.** KAD-24's job is done and
  verified on a 40-artwork live slice, but the full ~47.4k run (roughly an
  hour) has not been triggered. Sprint 7's scanner needs it; it is safe to
  interrupt and resumes where it stopped, so it can be run whenever.
- **CI exists and runs** (`.github/workflows/ci.yml`, added in KAD-20) —
  the repo had no `.github/` at all before that. It has been running on
  every push to `main` since KAD-20 landed; check with `gh run list`.
