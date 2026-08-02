# Sprint 3 plan (handoff snapshot)

Copied verbatim from the approved Claude Code plan so work can resume on a
different machine. This is a working doc, not an ADR — delete once Sprint 3
ships (fold anything durable into an ADR or CLAUDE.md first).

## Progress as of this snapshot

**KAD-16 in progress.** `packages/query-parser/` scaffolded (package.json,
tsconfig.json, eslint.config.mjs matching the `packages/phash` template) with
`src/ast.ts`, `src/operators.ts`, `src/errors.ts` written. Still needed:
`src/tokenizer.ts`, `src/parser.ts`, `src/index.ts` barrel, and
`src/parser.test.ts` (test table first, per the ticket) — see the tokenizer
design notes below the plan, which were worked out but not yet written to
disk:

- Tokenizer scans char-by-char: `(`/`)` emit LPAREN/RPAREN, `-` emits MINUS
  (unconditionally, even before whitespace — simple v1 rule), everything else
  scans a "term" up to the next whitespace/paren, quote-aware (a `"` toggles
  a mode where whitespace doesn't terminate the term, unterminated quote is a
  `QuerySyntaxError`).
- Each scanned term is matched against `^([A-Za-z]+)(:|!=|>=|<=|>|<|=)(.*)$`
  (comparators ordered 2-char-first so `!=`/`>=`/`<=` aren't shadowed by
  `>`/`<`/`=`). Match → operator term: lowercase the key, look up
  `OPERATOR_ALIASES`; unknown key throws `UnsupportedOperatorError`; empty
  value (`c:` with nothing after, incl. `c:""`) throws `QuerySyntaxError`
  ("operator requires a value"). No match → literal `"AND"`/`"OR"` (exact
  case) become keyword tokens, everything else is a `word` (name) token.
  Quoted values/words get their surrounding `"..."` stripped.
- Parser (recursive descent over the token array, index cursor):

  ```text
  orExpr   := andExpr ("OR" andExpr)*
  andExpr  := unary (("AND")? unary)*   // stops at OR/RPAREN/EOF
  unary    := MINUS unary | primary
  primary  := LPAREN orExpr RPAREN | OPERATOR_TOKEN | WORD_TOKEN
  ```

  Stray RPAREN, unclosed LPAREN, or a dangling AND/OR/MINUS at EOF all throw
  `QuerySyntaxError` naming what was expected.
- `parseQuery("")` (or whitespace-only) throws `QuerySyntaxError("empty
  query")` deliberately — the caller (KAD-19 UI) is expected to special-case
  a blank search box as "no filter" *before* calling `parseQuery`, rather
  than the parser inventing an "always true" AST node for it.

None of this is committed as working code yet — the tokenizer/parser files
don't exist on disk. Resume by writing `tokenizer.ts` per the notes above,
then `parser.ts`, then `index.ts` (barrel: `parseQuery`, AST types, error
classes), then the test table, then run `pnpm test` / `pnpm typecheck` /
`pnpm lint` for `packages/query-parser` before moving to KAD-17.

KAD-17 through KAD-20 are not started.

---

## Full plan

<!-- BEGIN-PLAN -->

# Sprint 3 — Query Engine (KAD-16 → KAD-20)

## Context

Sprint 3 is the first sprint of **R2 · Brewing**. It builds the Scryfall-compatible
search query engine that everything else in this milestone depends on (deck
editor search, "owned only" build mode, collection browse). Five Linear stories,
17 points, dependency-ordered:

- **KAD-16** (5pt) — recursive-descent parser: query string → typed AST
- **KAD-17** (5pt) — AST → parameterized SQL compiler
- **KAD-18** (2pt) — explicit errors for unsupported operators
- **KAD-19** (3pt) — collection browse UI wired to the search bar
- **KAD-20** (2pt) — perf test at 20k/110k row scale (NFR-1, p95 ≤200ms)

Research findings that shape this plan:
- No query/parser code exists yet. The only "search" today is
  `apps/web/src/server/search/{query.ts,fts.ts}` — a raw `cards_fts MATCH`
  helper with no AST, used nowhere near this new engine's scope.
- `collectionItems` has **no `tag` column** — `tag:` is declared in KAD-16's v1
  grammar but its storage is KAD-22 (Sprint 4). Per the working decision: the
  parser recognizes `tag:` syntactically, but the compiler raises the same
  explicit "unsupported" error KAD-18 introduces, with a message noting it
  lands in Sprint 4. No migration for tags now.
- Per the working decision: the parser lives in a new **`packages/query-parser`**
  workspace, following the `packages/phash` template exactly (no build step,
  consumed as TS source, auto-picked-up by the `packages/*` workspace glob and
  Vitest's `node` project glob). The SQL compiler stays in
  `apps/web/src/server/search/` since it needs the DB.
- Confirmed via Scryfall docs: `c:`/`id:` both default to `>=` ("at least these
  colors, possibly more"); `=`/`<=`/`<`/`>`/`!=` are explicit overrides. This
  resolves KAD-17's "handle subset/superset correctly" AC.
- ADR-007 already anticipates this: RSC pages aren't Vitest-testable, so
  KAD-19's browse page gets a Playwright spec (`apps/web/e2e/`), not a
  `.test.tsx`. Pure logic (parser, compiler) gets full Vitest coverage.
- `cards.colors`/`colorIdentity`/`finishes` are JSON-serialized TEXT columns
  (no native array type) — color/identity/finish predicates compile to
  `json_each`-based EXISTS/NOT EXISTS fragments, not plain `=`.
- **CI note**: the repo's `gh` token currently lacks the `workflow` scope, so
  changes to `.github/workflows/*` can't be pushed. KAD-20 asks for the perf
  test to "run in CI." Build the benchmark script and wire it as an npm
  script; actually adding it to the CI workflow file needs
  `gh auth refresh -s workflow` first (or a manually-applied edit) — flag
  this again on arrival rather than silently skipping it.

## Architecture

### 1. `packages/query-parser` (KAD-16 + parser half of KAD-18)

Scaffold identical to `packages/phash`: `package.json` (`@mtg/query-parser`,
private, `main`/`types` → `src/index.ts`, `exports`, `lint`/`typecheck`/
`typecheck:tsgo` scripts), `tsconfig.json` extending `tsconfig.base.json`.

Files:
- `src/ast.ts` — typed AST: `AndNode | OrNode | NotNode | NameNode |
  OperatorNode`. `OperatorNode` carries `{ operator: OperatorKey, comparator:
  ":" | "=" | "!=" | ">" | ">=" | "<" | "<=", value: string }`. The parser
  stays semantically dumb — it records the literal comparator token; the
  *compiler* decides what a bare `:` defaults to per operator (`>=` for
  color/identity, `=` for everything else), keeping the parser pure and the
  semantic knowledge in one place (KAD-17).
- `src/operators.ts` — the fixed v1 operator table: canonical key + aliases
  (`c`/`color`, `id`/`identity`, `t`/`type`, `o`/`oracle`, `cmc`, `set`/`e`,
  `r`/`rarity`, `is`, `owned`, `binder`, `tag`, `condition`). Single source of
  truth the parser validates operator tokens against.
- `src/tokenizer.ts` — lexer: words, quoted strings, `-`, `(`, `)`, `AND`,
  `OR`, comparator symbols, operator-key `:` detection.
- `src/parser.ts` — recursive descent, standard precedence (OR loosest,
  implicit-AND via juxtaposition next, `-` negation tightest, parens reset):

  ```text
  orExpr   := andExpr ("OR" andExpr)*
  andExpr  := unary ("AND"? unary)*
  unary    := "-" unary | primary
  primary  := "(" orExpr ")" | operatorTerm | bareWord
  ```

- `src/errors.ts` — `QueryParseError` (base), `UnsupportedOperatorError`
  (extends it, carries the offending operator key) — thrown the moment the
  tokenizer sees `word:` where `word` isn't in the v1 operator table. This is
  KAD-18's mechanism for the general case (unknown operator key). Also a
  `QuerySyntaxError` for malformed syntax (unclosed paren, dangling operator,
  bad comparator for a non-numeric field, etc.) — every error names what's
  wrong, never a silent parse.
- `src/index.ts` — barrel, exports `parseQuery`, AST types, error classes.
- `src/parser.test.ts` — **write the test table first**, per the ticket.
  Table-driven cases per operator × comparator × valid/invalid, plus
  AND/OR/NOT/paren nesting, plus one case per unsupported-operator error.

### 2. AST → SQL compiler (KAD-17 + compiler half of KAD-18)

`apps/web/src/server/search/compile.ts` — `compileQuery(ast: QueryNode):
SQL` (drizzle `sql` tagged-template fragments only, per the existing
`query.ts`/`fts.ts` convention — never string-concatenate a value).

Design decision on scope: the compiled fragment is built to run against
`FROM collection_items JOIN cards ON collection_items.scryfallId = cards.id`
(one row per owned stack) because that's what KAD-19 actually needs — a
collection browse, not a full-catalog browse. `owned:` is accepted
syntactically (it's real v1 grammar) but is a documented no-op in this
context, since every row here is already owned by construction; it becomes
meaningful once a future full-catalog surface (KAD-27+, out of this sprint)
reuses the same parser package against a `cards`-only base. This avoids
building two compiler modes speculatively.

Per-operator compilation:
- `c:`/`id:` → `colors`/`colorIdentity` JSON columns. Value parses to a
  WUBRG letter set (plus `c` for colorless = empty set). `>=`: AND of
  per-letter `EXISTS(SELECT 1 FROM json_each(cards.colors) WHERE value=?)`.
  `<=`: AND of per-letter-NOT-in-set `NOT EXISTS(...)`. `=` = both combined;
  `!=`/`>`/`<` compose from those two.
- `t:`/`o:` → `LIKE '%value%'` (case-insensitive, `ESCAPE` clause to
  neutralize user-supplied `%`/`_` — ticket explicitly warns against
  confidently-wrong results, and an un-escaped LIKE wildcard from user input
  is exactly that class of bug) against `typeLine`/`oracleText`.
- bare word (implicit name search) → `LIKE '%value%'` against `cards.name`,
  same escaping. Deliberately not routed through `cards_fts MATCH`: MATCH
  doesn't compose cleanly inside arbitrary AND/OR/NOT trees alongside
  non-FTS predicates, and the AC is result-correctness, not ranking. Existing
  `searchCards()` FTS helper is untouched.
- `cmc` → numeric compare against `cards.cmc`; default comparator `=` for a
  bare colon (numeric field, unlike color fields); non-numeric value is a
  `QuerySyntaxError` from the parser layer, not a silent 0-row query.
- `set:`/`e:` → `=` against `cards.setCode` (lowercased, matches
  `setCodeSchema` convention already in `packages/schemas`).
- `r:`/`rarity:` → `=` against `cards.rarity` (lowercased). No ordinal
  comparators in v1 — the ticket calls out comparators explicitly for `cmc`
  only, not `r:`.
- `is:` → fixed v1 sub-values backed by real columns: `reserved`, `fullart`,
  `textless`, `promo`, `variation` (direct boolean columns) plus `foil` /
  `nonfoil` / `etched` (json_each over `finishes`). Any other `is:` value is
  an explicit `QuerySyntaxError` naming the bad value — same
  named-not-silent philosophy as KAD-18, applied at the value level.
- `owned:` → `true`/`false` only; compiles to a trivial always-true/false
  given the joined-context decision above (documented, see above).
- `binder:` → `LIKE` (escaped) against the joined `collectionItems.binderLocation`.
- `condition:` → `=` against the joined `collectionItems.condition`
  (validated against the `CONDITIONS` tuple from `packages/schemas`).
- `tag:` → compiler throws (not the parser) a distinct, explicit
  `UnimplementedOperatorError("tag: is recognized but not implemented yet —
  lands in Sprint 4 (KAD-22)")`. Deleting this branch is the entire
  integration cost once KAD-22 adds the column.

Indexes: add `rarity`, `setCode` (already has a composite with
collector_number but not alone), and `cmc` single-column indexes to
`apps/web/src/server/db/schema.ts`, generated via `pnpm db:generate` (plain
columns, unlike the hand-written FTS5 migration — drizzle-kit handles this
normally). JSON columns (`colors`/`colorIdentity`/`finishes`) stay
unindexed for v1; if KAD-20's benchmark shows this is the bottleneck, that's
a recorded finding per the AC ("not necessarily a hard gate yet"), not a
blocker — a bitmask-column redesign would touch the already-Done KAD-8
ingest job and is real scope, not something to sneak into this sprint.

Tests: `compile.test.ts` using the existing temp-file-DB harness pattern
(`vi.resetModules()` + fresh `DATABASE_PATH` + dynamic re-import, as in
`search/query.test.ts`) with pinned fixture cards/collection_items covering
each operator and the color subset/superset edge cases (incl. the
`c:wurbg` ≡ `c=wurbg` maximal-set case from the ticket).

### 3. Collection browse UI (KAD-19)

New `apps/web/src/app/collection/page.tsx` — async Server Component
following the conventions in `reconciliation/page.tsx`/`page.tsx`: Tailwind
v4 utilities directly, zinc/amber/blue palette, `dark:` variants, raw
`<img>` for card thumbnails with the same biome-ignore comment (image is
`cards.imageUris`, uncropped per the provider requirement already respected
elsewhere), `await connection()` before the DB read (Cache Components gotcha
from CLAUDE.md).

- Search bar is a `<form>` with a GET query param (`?q=...`), parsed via
  `parseQuery` from `@mtg/query-parser` server-side; parse errors render
  inline (naming the bad operator/value, not a generic "invalid search").
  No client JS needed for the basic case — matches the existing
  server-action-over-client-fetch convention.
- Grid/list view toggle via a query param, both driven by the same result
  set.
- Responsive, primary controls (search, view toggle) in the lower third on
  phone width per NFR-7, matching the reconciliation page's mobile handling.
- New `apps/web/e2e/collection.spec.ts` (Playwright, per ADR-007 — this page
  can't be Vitest-tested): search happy path, unsupported-operator error
  display, grid/list toggle, one assertion that copyright/artist text on a
  card image isn't clipped.

### 4. Perf test (KAD-20)

- `apps/web/src/server/search/perf-fixture.ts` — deterministic synthetic
  generator (no faker dependency) producing ~110k varied card rows (spread
  across colors/types/rarities/sets) and ~20k `collection_items` rows
  referencing them, batch-inserted respecting the existing 200-row SQLite
  bound-parameter batch size from `bulk-cards.ts`.
- `apps/web/src/server/search/perf.bench.test.ts` — seeds the fixture into a
  fresh temp-file DB (same harness pattern), runs a representative set of
  compiled queries (single operator, multi-operator AND, color subset/
  superset, OR/NOT), records p50/p95 wall-clock per query via
  `console.table`/structured output. Not wired into the default `pnpm test`
  glob (matches the CLAUDE.md convention for expensive, non-mocked runs) —
  new `"test:perf"` script in root `package.json` runs it explicitly.
  Assertions log/report the NFR-1 target (≤200ms p95) without hard-failing
  the run, per the AC's "not necessarily a hard gate yet."
- CI wiring: add a step to whatever the existing test workflow is, calling
  `pnpm test:perf`. Attempt this on arrival; if it turns out to require
  `.github/workflows/*` edits and hits the missing `workflow` scope, stop
  and flag it rather than force it.

## Commit plan

Per the working agreement (direct to `main`, one commit per story,
Linear issue id in the subject, mark Done + comment SHA as each lands — no
batching to the end):

1. `KAD-16` — `packages/query-parser` package + parser/AST/tests
2. `KAD-17` — compiler + schema indexes/migration + compile tests
3. `KAD-18` — (mostly already landed inside 1–2; this commit is the
   remaining explicit-error polish + tests specifically exercising the
   named-error ACs, e.g. `tag:`'s Sprint-4 message, `is:` bad-value, bad
   comparator on `cmc`)
4. `KAD-19` — collection browse page + Playwright spec
5. `KAD-20` — perf fixture + bench script + (CI wiring, if unblocked)

## Verification

- `pnpm typecheck` and `pnpm lint` (Biome) across the workspace after each
  commit.
- `pnpm test` (Vitest) green throughout — baseline is 23 files / 107 tests
  passing now; new parser/compiler tests add to that count.
- `pnpm test:e2e` (Playwright) for the new `collection.spec.ts` — per
  CLAUDE.md's own lesson, this must actually run (install Chromium if
  needed), not just exist.
- `pnpm test:perf` run once manually to confirm it produces a p50/p95
  report and doesn't crash at 110k/20k scale.
- `pnpm db:generate` + review the generated migration SQL for the new
  indexes before applying.
- Manual smoke: `pnpm dev`, load `/collection`, try a handful of real
  queries (`c:rg`, `t:creature -is:reserved`, `binder:box1`, an unsupported
  operator, a malformed `cmc` value) and confirm error text names the
  problem.

<!-- END-PLAN -->
