# Sprint 4 plan

Working doc, not an ADR — delete once Sprint 4 ships (fold anything durable
into an ADR or CLAUDE.md first, the way Sprint 3's snapshot was retired).

## Progress

4 of 5 stories done (12 of 17 points). Remaining: **KAD-24** only.

- **KAD-21** done — `c256ae5`. AC2 descoped to KAD-32 (Sprint 6) as
  recommended below; there are no decks to display locations against yet.
- **KAD-22** done — `03c586d`. AC1 was already satisfied by KAD-12 and was
  closed as such rather than reworked; the story was tags only.
- **KAD-23** done — `abe7ad2`. Also added `POST /api/import/collection`,
  which was not in this plan: without it the JSON export is a file the app
  can write and never read, and AC2 would be observable only from the test
  suite. Moxfield confirmed lossy by design (open question 3), so the
  round-trip gate covers JSON and CSV.

- **KAD-25** done — `510374e`. Two binarization findings are written up on
  the ticket; the second (float comparison was not safe across JS engines,
  so coefficients are quantized before comparison) is a genuine correction
  to the design sketched below, not just an implementation detail.

Also `c4fa47b`, not a story: the e2e suite seeded into the working dev
database once per *worker*, and a second run within an hour pushed the
binder facet past `BINDER_FACET_LIMIT` so a KAD-21 chip fell off the list.
It now has its own database and seeds once per file.

Test baseline is now **35 files / 471 tests** (was 27/292 at sprint start),
plus 16 Playwright tests. `.github/workflows/ci.yml` is still unpushed,
blocked on the missing `gh` `workflow` scope.

**Open questions still to settle for KAD-24:** `sharp` vs `jpeg-js` (#4,
decide after checking what a second native dependency costs the Dockerfile)
and whether to let the full ~47.4k-artwork run go after verifying on a
slice. KAD-57 (#5) remains unscheduled.

---

## Sprint 4 — Collection depth + the hash index (KAD-21 → KAD-25)

### Context

Second sprint of **R2 · Brewing**. Five stories, 17 points. It finishes the
collection-management epic (US-3.2/3.3/3.4) and, in parallel, starts the
recognition pipeline's long pole.

- **KAD-21** (3pt) — binder location tracking + location filter
- **KAD-22** (3pt) — tags and per-copy condition tracking
- **KAD-23** (3pt) — export CSV / JSON / Moxfield, round-trip lossless
- **KAD-25** (3pt) — `packages/phash`: DCT hash + Hamming distance
- **KAD-24** (5pt) — hash index build job

#### Dependency order is not ticket order

Run them **21 → 22 → 23 → 25 → 24**. KAD-24 consumes `packages/phash`, so
KAD-25 has to land first despite the higher number. KAD-23's round-trip test
is the real acceptance gate, and it can't be written honestly until binder
locations and tags exist to round-trip — so export goes third, not first.

#### Research findings that shape this plan

**A good chunk of KAD-21 and KAD-22 is already built.** Worth knowing before
committing 6 points to them:

- `collectionItems.binderLocation` already exists, is `NOT NULL`, and is part
  of the stack uniqueness index. The `binder:` query operator already
  compiles and is already benchmarked (11.5ms p95 at scale). KAD-21's real
  remaining work is **UI only** — display and edit.
- **KAD-22's AC1 (per-copy condition tracked independently) is already
  satisfied** by KAD-12's design: `condition` is part of the
  `(scryfall_id, finish, condition, is_proxy, binder_location, language)`
  unique index, so two copies in different conditions are already two
  separate stacks. `condition:` already compiles and is benchmarked. The
  actual work in KAD-22 is **tags, and only tags**.

**KAD-21's AC2 cannot be done this sprint.** It reads "Given a deck list,
when viewed, then each card shows where its physical copy is stored" —
there are no decks. `decks`/`deck_cards` land in KAD-26, Sprint 5. Options
are to descope AC2 onto KAD-32 (ownership overlay on deck lists, Sprint 6,
which is where that UI actually gets built) or to leave KAD-21 open across
sprints. **Recommendation: descope to Sprint 6 and close KAD-21 on AC1 +
the filter.** Decide this on arrival rather than silently shipping 2 of 3
ACs.

**Export can't round-trip through today's importer.** The Archidekt importer
(`archidekt-columns.ts`) recognizes exactly nine canonical fields:
`scryfallId, name, setCode, setName, collectorNumber, quantity, foil,
condition, language`. It has **no** notion of `binderLocation`, `isProxy`,
or tags. So a CSV export carrying those fields would silently drop them on
re-import, and KAD-23's AC2 ("re-imported → lossless") would fail against
the very fields Sprints 4's other two stories just added. This is the
central design problem of KAD-23, not an afterthought — see below.

**Scryfall API, re-verified live 2026-08-03** (per CLAUDE.md's standing rule
not to trust stale docs, including this file's):

- `unique_artwork` exists as a bulk type, gzip JSONL like the others.
  `compressed_size` 37.2 MB vs `default_cards` 77.3 MB. Note the `size`
  field the ticket's ~207 MB/~462 MB figures came from **is now absent** —
  only `compressed_size` is returned. The ~0.48 ratio still holds.
- **47,402 unique artworks** vs **96,511 paper printings**. That is the
  reprint-art problem quantified, and it is the number that sizes KAD-24's
  download.
- `illustration_id` is a real top-level field (confirmed on a live card) and
  is the artwork identity KAD-24 needs. It is **not** in
  `packages/schemas/src/scryfall-card.ts` and **not** a column on `cards`.
  KAD-24 has to add both.
- `image_uris` now carries more keys than the classic six: `art`, `crop`,
  `display`, `grid`, `thumb` alongside `small/normal/large/png/art_crop/
  border_crop`. This does **not** affect KAD-19's image picker, which
  allow-lists eligible sizes rather than deny-listing cropped ones — worth
  noting as a case where the allow-list choice paid off.

### Architecture

#### 1. KAD-21 — binder location (UI only)

No schema change, no compiler change. Extend `/collection`:

- Each result gains an inline edit affordance for `binderLocation`. Use a
  server action (`updateCollectionItem` already exists in
  `server/collection/items.ts`, and `updateCollectionItemRequestSchema`
  already accepts `binderLocation`) — matches the
  server-action-over-client-fetch convention from the reconciliation page.
- **The uniqueness index makes this a UX decision, not a plumbing one.**
  `binderLocation` is part of the stack key, so moving a stack into a
  location where an identical stack already sits is a collision.
  `updateCollectionItem` already handles it deliberately: it catches
  `SQLITE_CONSTRAINT_UNIQUE` and returns `{ outcome: "conflict" }`, with a
  documented rationale that merging would have to combine quantities and the
  caller never asked for that. So the server is fine and the question is what
  the *story* wants: surface "a stack already exists there" and stop, or add
  an explicit merge path. **Recommendation: surface the conflict in v1** — it
  matches the existing contract, and silently combining two physical stacks
  is the kind of thing a user wants to have agreed to.
- A location facet/filter affordance that composes into the existing query
  string (`binder:box1`) rather than being a parallel filtering mechanism.
- Tests: contract tests for the collision case in `items.test.ts`; the page
  itself gets a Playwright case (edit a location, see it persist and the
  `binder:` filter pick it up).

#### 2. KAD-22 — tags

New table plus the compiler branch that KAD-17 deliberately stubbed out.

```text
collection_item_tags
  collection_item_id  text NOT NULL REFERENCES collection_items(id) ON DELETE CASCADE
  tag                 text NOT NULL          -- normalized: trimmed, lowercased
  created_at          integer NOT NULL
  PRIMARY KEY (collection_item_id, tag)
```

- Free-form, no vocabulary table. Normalize on write (trim + lowercase) so
  `Cube` and `cube` are one tag; keep the display form out of scope for v1.
- `ON DELETE CASCADE` matters: deleting a stack must not orphan tag rows.
  Note the foreign-key ordering trap from CLAUDE.md — the parent row must
  exist before any tag insert, including mid-loop.
- Migration via `pnpm db:generate` (a plain table, so drizzle-kit handles it
  normally — unlike the hand-written FTS5 migration).
- **Compiler**: replace the `UnimplementedOperatorError` branch at
  `compile.ts:274` with an `EXISTS (SELECT 1 FROM collection_item_tags WHERE
  collection_item_id = collection_items.id AND tag = ?)` fragment. Deleting
  that branch is the entire integration cost, exactly as KAD-17 planned it.
  `-tag:cube` then falls out of the existing `NOT` handling for free.
- **The cleanup ripples further than the compiler.** `tag:` is
  `UnimplementedOperatorError`'s only thrower, so removing that branch
  strands the whole error path behind it: the class in
  `packages/query-parser/src/errors.ts`, its re-export, the
  `"unimplemented-operator"` kind in `search/query-errors.ts`, that kind's
  case in `collection-view.ts`'s `errorHeading`, and the Playwright
  assertion in `collection.spec.ts` that looks for the "Sprint 4" text.
  Decide deliberately whether to keep the machinery for a future deferred
  operator or delete it wholesale — but don't leave a dead error type and an
  unreachable UI branch lying around, and don't leave the e2e test asserting
  a message that no longer exists.
- Tags UI on `/collection` (add/remove per stack, server action).
- Tests: compiler cases for `tag:`, `-tag:`, `tag:` combined with other
  operators; contract tests for cascade-on-delete; a Playwright case for
  tag → filter.

#### 3. KAD-23 — export

`server/export/` with one module per format and a shared row-gathering query.

The honest resolution of the round-trip problem:

- **JSON is the lossless format.** Full fidelity — every column including
  `binderLocation`, `isProxy`, `language`, and tags. A matching JSON import
  path is what AC2's round-trip test actually exercises.
- **CSV becomes lossless too, by teaching the importer three new fields.**
  Add `binderLocation`, `isProxy`, and `tags` to `CANONICAL_FIELDS` +
  `COLUMN_ALIASES` in `archidekt-columns.ts` (tags as a delimited list in
  one cell). This is a small, contained change and it's what makes CSV
  round-trip rather than quietly lossy. Third-party CSVs without those
  columns keep working — the column map is already alias-based and tolerant
  of missing fields.
- **Moxfield text is lossy by design and documented as such.** It's a
  deck-list text format; there is nowhere to put a binder location. Do not
  contort it. State the limitation in the export UI, and scope AC2's
  round-trip gate to JSON and CSV.

Tests: the round-trip test *is* the acceptance gate, per the ticket — seed a
collection with every field populated (including tags, proxies, non-`en`
language, and a binder location containing a comma and a quote), export,
re-import into a fresh DB, and assert deep equality of the normalized rows.
That CSV-quoting case is the one most likely to break and the least likely
to be covered by a hand-written fixture.

#### 4. KAD-25 — `packages/phash`

Currently a 3-line placeholder. Build it out on the `packages/query-parser`
template (no build step, consumed as TS source, picked up by the
`packages/*` workspace glob and Vitest's node project).

- `src/dct.ts` — separable 2D DCT-II. 32×32, so a plain O(n³) separable
  implementation is fine (~65k multiply-adds per image); no FFT needed.
- `src/resize.ts` — box-filter downscale to 32×32.
- `src/gray.ts` — RGBA → luma.
- `src/hash.ts` — `phash(image: {data: Uint8ClampedArray; width; height}):
  bigint`. Grayscale → 32×32 → DCT → top-left 8×8 → binarize against the
  median. **Exclude the DC coefficient from the median** — it carries
  overall brightness and skews the threshold; this is the standard gotcha
  and the reason two implementations of "the same" pHash disagree.
- `src/distance.ts` — Hamming via BigInt XOR + popcount, plus a
  `BigUint64Array` bulk-scan helper for the "load into a typed array at
  boot" AC.
- `src/index.ts` — barrel.

**The critical isomorphism constraint:** the package takes *decoded pixels*,
never an encoded image. Decoding is environment-specific (browser:
`createImageBitmap`/canvas; Node: see KAD-24) but **resize, grayscale, DCT
and binarization must all live in this package and be the only
implementation**. If the index were built using a decoder library's own
resize and the scanner used this package's resize, the two would produce
different hashes and matching would fail — a bug that would not surface
until Sprint 7's corpus run, by which point 47k images have been hashed
wrong. This is the single highest-consequence design decision in the sprint.

Tests: known-image → known-hash fixtures (commit a couple of tiny generated
PNGs, not card art); distance symmetry and identity; and the robustness AC —
mild resize and JPEG recompression must stay within a small Hamming
distance. Generate the recompressed variants deterministically in the test
rather than committing binary fixtures for each.

#### 5. KAD-24 — hash index build job

`server/ingest/hash-index.ts`, following the `bulk-cards.ts` shape (stream
the gzip JSONL, validate at the Zod boundary, batch writes, report through
`sync_state` — `hash_index` is already a declared `SyncType` and already
renders on the status page as "Hash index", currently non-triggerable).

Schema work first:

- Add `illustration_id` to `scryfallCardSchema` (optional — reversible/
  double-faced layouts carry it per-face, same as `oracle_id`).
- Add `illustrationId` column + index to `cards`, and map it in
  `card-row-mapper.ts`.
- New table for the artwork index, so the job is resumable against a stable
  key:

```text
artwork_hashes
  illustration_id  text PRIMARY KEY
  art_phash        blob NOT NULL   -- 8 bytes, big-endian
  full_phash       blob
  source_card_id   text NOT NULL   -- which printing's image was hashed
  created_at       integer NOT NULL
```

Resumability falls out of this: the job selects the artworks it hasn't
hashed yet (`LEFT JOIN artwork_hashes ... WHERE illustration_id IS NULL`),
so killing and restarting redoes nothing. Incremental subsequent runs are
the same query. Propagate to `cards.artPhash`/`fullPhash` with a single
`UPDATE ... FROM artwork_hashes` join at the end — those BLOB columns
already exist on `cards`, added speculatively in KAD-6.

Download shape:

- Source of truth is the `unique_artwork` bulk file (~47.4k rows), filtered
  through the existing `isCollectibleCard` policy so tokens and emblems
  never enter the index (an explicit AC).
- Hash `art_crop` for `artPhash`. The KAD-19 prohibition on `art_crop` was
  about *display* (it clips the artist credit) and does not apply here —
  cropping to the art is precisely what's wanted.
- **For `fullPhash`, use `small`, not `normal`.** A 64-bit pHash downsamples
  to 32×32 regardless, so 146×204 is ample. `art_crop` at ~100 KB × 47.4k is
  already ~4.7 GB; adding `normal` (~200 KB) would take the job past 14 GB,
  while `small` (~10 KB) adds only ~0.5 GB for an identical hash. This is
  free and worth taking.
- Images are **streamed, hashed, and discarded** — nothing is written to
  disk but the 8-byte hashes. No image cache, no volume growth.
- Bounded concurrency (start at 8) with exponential backoff on 429/503.
  Note the validated finding in the ticket: only `api.scryfall.com` carries
  the documented rate limit; `*.scryfall.io` image hosts don't. Be polite
  anyway — 47k requests is a lot to point at someone's CDN.
- Node-side decode: **`sharp` for decode-to-raw-pixels only**, never for
  resize (see the isomorphism constraint above). It's a native dependency,
  so the Dockerfile needs the same treatment `better-sqlite3` already gets —
  check that before committing to it. `jpeg-js` is the pure-JS fallback if
  the native dep proves painful in the image; the job is I/O-bound, so the
  speed difference is not decisive.
- Trigger + progress on the sync status page (`hash_index` becomes
  triggerable; `TRIGGER_ACTIONS` in `app/page.tsx` gains an entry, and the
  "no job to trigger yet" comment there comes out).

The ticket's closing note — hashing multiple regions per card for redundancy
against segmentation drift — is exactly what art + full gives us. Treat that
as satisfied rather than adding a third region speculatively.

**Runtime expectation:** this is a multi-hour job. Verify it end to end on a
small slice first (a few hundred artworks via an explicit limit), confirm
resumability by killing it mid-run and restarting, *then* let the full run
go. Per CLAUDE.md, a job that hits a real external API gets verified for
real at least once — and this one has 47k chances to be wrong.

### Commit plan

Per the working agreement (direct to `main`, one commit per story, Linear id
in the subject, mark Done + comment the SHA as each lands — not batched):

1. `KAD-21` — binder location display/edit + filter affordance
2. `KAD-22` — tag table, migration, `tag:` compiler branch, tags UI
3. `KAD-23` — export modules, importer field extensions, round-trip test
4. `KAD-25` — `packages/phash` implementation + tests
5. `KAD-24` — schema additions, hash index job, status-page wiring

### Verification

- `pnpm typecheck` + `pnpm lint` (Biome **and** ESLint — they disagree, and
  only Biome is auto-fixable) after each commit.
- `pnpm test` green throughout; baseline is 27 files / 292 tests.
- `pnpm test:e2e` actually run, not just written — the standing lesson.
- `pnpm test:perf` after KAD-22: the `tag:` operator adds an `EXISTS`
  subquery to the compiler, so re-run the benchmark and add a `tag:` case.
  Current worst p95 is 41ms against a 200ms target, so there's room — but
  confirm rather than assume.
- `pnpm db:generate` for KAD-22 and KAD-24, reviewing the generated SQL
  before applying.
- A real `next build` after any page change, confirming routes still render
  `ƒ Dynamic` (and noting KAD-57: the first build against an empty `data/`
  still races on migrations).
- KAD-24 verified on a small slice, killed and resumed, before the full run.

### Open questions to settle on arrival

1. **KAD-21 AC2** — descope the deck-list location display to Sprint 6
   (KAD-32), or hold KAD-21 open? Recommendation above: descope.
2. **KAD-22 AC1** — already satisfied by KAD-12. Close it as such in the
   Linear comment rather than doing redundant work.
3. **Moxfield export** — confirm lossy-by-design is acceptable for AC2, or
   the round-trip gate has to be narrowed explicitly in the ticket.
4. **`sharp` vs `jpeg-js`** — decide after checking what the Dockerfile
   costs for a second native dependency.
5. **KAD-57** (build/migration race) is unscheduled and sitting in the
   backlog at High. It's not in this sprint's 17 points; decide whether it
   jumps the queue, since it breaks a fresh `docker compose up --build`.
