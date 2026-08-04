# Sprint 5 plan — R2 · Brewing, deckbuilding

Committed: **17 points**, 5 stories (KAD-26, KAD-28, KAD-30, KAD-31, KAD-27).
Same shape as the Sprint 3 and Sprint 4 plan docs — context, per-story
architecture, commit plan, verification. Working doc; deleted once the
sprint ships and its lessons move to CLAUDE.md.

Grounded in a codebase pass rather than the ticket text alone. That turned
up four things worth deciding before writing code.

## Findings from the grounding pass

### 1. `deck_allocations` presupposes a decision this sprint isn't allowed to make

KAD-26 says "Tables: `decks`, `deck_cards`, `deck_allocations` per ERD §4."
But the working-agreements doc lists **Q2 — "Is deck allocation *reserving*
physical copies, or advisory only?" — as an open product question due at S6
(ADR-004)**, and ADR-004 is KAD-34, next sprint. KAD-33 (conflict detection
across decks) is also Sprint 6.

Building the full allocation table now would bake in an answer to Q2 by
accident: a reservation model wants a decrementing/held-quantity column and
a uniqueness constraint preventing over-allocation, an advisory model wants
neither. Those are different tables.

**Decision:** create `deck_allocations` with only the shape *both* semantics
share — `deck_id`, `collection_item_id`, `quantity`, timestamps — and add no
constraint that enforces either reading. No allocation *behavior* ships this
sprint; KAD-26's AC list doesn't ask for any. Sprint 6's ADR-004 then adds
the columns/constraints its chosen semantics needs. Recorded here so the
Sprint 6 planner doesn't mistake the stub for a settled design.

### 2. KAD-30's AC3 is nearly free, and the way to keep it free is to not optimize

AC3: "Given banlist data changes after a sync, then affected decks reflect
it without manual re-entry." `cards.legalities` is already a NOT NULL JSON
column that the KAD-8 bulk upsert refreshes on every sync. So AC3 holds
automatically **as long as validation joins `deck_cards → cards` and reads
`legalities` at validate time**.

The way to break it is to denormalize legality onto `deck_cards` at insert
time as a performance nicety. Don't. A deck is ≤100 rows; there is no perf
problem to solve here, and NFR-1's benchmark (worst p95 41ms over 110k
cards) says the join is not going to be the bottleneck.

### 3. Singleton exemptions and partner detection both have real corpus dependencies

Everything needed is already columns on `cards`:

- Basic-land exemption → `type_line` contains `Basic` (`Basic Land — Forest`).
  Note `Snow-Covered Forest` is also `Basic Land`, correctly exempt.
- Any-number clause → `oracle_text` contains "A deck can have any number of
  cards named" (Persistent Petitioners, Dragon's Approach, Rat Colony, …).
  Relentless Rats-style text is the same phrasing. Text match, not a
  hand-maintained card list — same principle as "no hand-maintained banlist".
- Partner → the `keywords` JSON array carries `Partner`. But there are four
  distinct mechanics that combine identities: `Partner`, `Partner with`,
  `Friends forever`, and `Doctor's companion`, plus Backgrounds (which
  combine via "choose a Background", not a keyword).

**Scope call:** KAD-28 is 2 points and its AC says only "Partner commanders
combine identities." I'll implement `Partner`, `Partner with`, and `Friends
forever` — all three are keyword-detectable and share one code path — and
leave Backgrounds/Doctor's companion out with an explicit
`assertNever`-adjacent TODO and a test documenting the gap. Flagging rather
than silently descoping: if Backgrounds matter, that's a separate ticket.

### 4. The local dev DB has 70 cards, not 96k

`sqlite3 apps/web/data/mtg.db "select count(*) from cards"` → **70**. The
full bulk ingest has not been run against this working database. KAD-27's
"search-as-you-type against the local card DB" and KAD-30's banlist checks
cannot be meaningfully demoed against 70 rows, and the sprint-review
ceremony ("demo the increment to yourself") is part of the DoD.

**Action:** run the KAD-8 ingest before KAD-27. Independent of the hash
index run, which is a separate (~1hr) job that Sprint 7 needs and can go in
the background whenever.

## Story order and architecture

Dependency order, not ticket order. Validation lands before the UI so the
editor has something real to render.

### KAD-26 · Deck schema + CRUD API (3)

Migration `0008`. Three tables:

- `decks` — `id`, `name`, `format` (present from the start per the AC, but
  only `commander` is validated in v1), `commanderCardId` /
  `partnerCardId` (nullable, FKs to `cards.id`), timestamps.
- `deck_cards` — `id`, `deckId` FK, `scryfallId` FK, `board`
  (`main`/`side`/`maybe`), `category` (free-form user string, empty string
  not NULL — same reasoning as `binderLocation` in KAD-12), `quantity`,
  timestamps. Unique index on (`deckId`, `scryfallId`, `board`) so adding a
  card twice increments rather than duplicating, matching the
  collection_items stack precedent.
- `deck_allocations` — stub per finding 1.

`packages/schemas/src/deck.ts` for the Zod wire contracts, exported from
the package index. `server/decks/` for the query layer,
`app/api/decks/route.ts` + `app/api/decks/[id]/route.ts` +
`app/api/decks/[id]/cards/route.ts` for the routes, each with a
`route.test.ts` contract test. `connection()` on GETs only, in the thinnest
possible wrapper (CLAUDE.md: it can't be unit-tested by direct invocation).

**Expect one failed `next build`** immediately after this migration lands —
that's KAD-57, not a new bug. Second build succeeds.

### KAD-28 · Commander color-identity derivation (2)

Pure function in `server/decks/color-identity.ts`: takes the commander
card row(s), returns the union of their `color_identity` arrays in WUBRG
order. Partner handling per finding 3. No DB writes — derived on read, so
it can never go stale against a re-sync (same principle as AC3 above).

### KAD-30 · Legality validation engine (5)

`server/decks/legality.ts`, a **pure function** taking a fully-hydrated
deck (cards joined, nothing lazy) and returning a structured result. No DB
access inside the rules themselves — that's what makes the dense unit
tests the AC asks for actually cheap to write.

Four rules, each its own function returning violations:
`singleton` (with the two exemptions), `deckSize` (100 including
commander), `colorIdentity` (every card's identity ⊆ the commander's), and
`banlist` (`legalities.commander !== "legal"`, which also catches
`not_legal` for un-cards and `restricted`).

### KAD-31 · Validation report naming card and rule violated (2)

This is the *shape of KAD-30's return type*, so it's designed in KAD-30 and
surfaced here. A violation is
`{ rule, cardName, scryfallId, detail }` — never a bare string. "Deck is
illegal" is explicitly not acceptable per the ticket. KAD-31 adds the UI
rendering plus the exhaustive `assertNever` switch over rule kinds, and the
pure formatting logic goes in a `.test.ts`-testable module rather than
inside an RSC (ADR-007 / CLAUDE.md testing conventions).

### KAD-27 · Deck editor UI with category grouping (5)

Last, because it consumes all four above. Search-as-you-type against the
existing FTS5 table (KAD-10) — reuse `server/search`, do not write a second
search path. Cards grouped by category, previews on hover/tap via
`image_uris`. Read-only review must work on a phone (pre-game check), which
is the DoD's "verified on the phone" clause.

E2E spec in `apps/web/e2e/decks.spec.ts`. Per CLAUDE.md: it runs against
`e2e.db`, `fullyParallel: false`, and any alert needs an explicit
`aria-label` because Next's route announcer already owns `role="alert"`.

## Commit plan

One commit per story, Linear id in the subject, issue marked Done with the
SHA as each lands — not batched to the end. Direct to `main` per the
working agreement's default (no PR unless asked). CI runs on every push and
is green as of `02bbb90`.

## Verification

- `pnpm test` (node + jsdom projects) green after each story.
- `pnpm typecheck` / lint clean, strict preserved. If a tsconfig change
  seems inert, delete `*.tsbuildinfo` before believing it.
- `next build` after the migration — expect the KAD-57 failure once, rerun.
- `pnpm test:e2e` actually run, not just written (two real bugs in Sprint 4
  surfaced only this way).
- Sprint review: demo the deck editor against a real ingested corpus, on a
  phone for the read-only path.
