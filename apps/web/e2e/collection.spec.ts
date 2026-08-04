import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { E2E_DATABASE_PATH } from "./db-path";

/**
 * Unlike the reconciliation spec - where the import pipeline *was* the
 * thing under test, so it seeded through the real API - the subject here is
 * the browse page. Seeding a printing plus an owned stack straight into the
 * dev server's SQLite file is the only way to get deterministic rows
 * without a full 110k-row Scryfall sync. WAL mode (db/client.ts) makes the
 * concurrent write safe while the dev server holds its own connection.
 *
 * The database is the dedicated e2e one, shared with the config that starts
 * the dev server - see `db-path.ts` for why these fixtures must not go in the
 * working dev database.
 */
const DB_PATH = E2E_DATABASE_PATH;

// Unique per run: the dev server's DB persists between runs, so a fixed
// name would accumulate rows and make count assertions drift.
const NONCE = randomUUID().slice(0, 8);
const CARD_NAME = `E2E Goblin ${NONCE}`;
const OTHER_CARD_NAME = `E2E Island ${NONCE}`;
const MOVE_CARD_NAME = `E2E Bear ${NONCE}`;
const CONFLICT_CARD_NAME = `E2E Wall ${NONCE}`;
const TAG_CARD_NAME = `E2E Ogre ${NONCE}`;
const BINDER = `e2e-${NONCE}`;
// A separate prefix, because `binder:` is a *contains* match: locations
// derived from BINDER would be swept up by the searches above.
const MOVE_FROM = `moved-${NONCE}-from`;
const MOVE_TO = `moved-${NONCE}-to`;
const CONFLICT_FROM = `taken-${NONCE}-from`;
const CONFLICT_TO = `taken-${NONCE}-to`;
const TAG_BINDER = `tagged-${NONCE}`;
const TAG = `cube-${NONCE}`;

interface SeedCard {
  readonly id: string;
  readonly name: string;
  readonly colors: string[];
  readonly typeLine: string;
  readonly cmc: number;
  /** One owned stack per location; two entries means two distinct stacks. */
  readonly binders: readonly string[];
}

function seed(): void {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  const now = Date.now();

  const cards: SeedCard[] = [
    {
      id: randomUUID(),
      name: CARD_NAME,
      colors: ["R"],
      typeLine: "Creature — Goblin",
      cmc: 1,
      binders: [BINDER],
    },
    {
      id: randomUUID(),
      name: OTHER_CARD_NAME,
      colors: ["U"],
      typeLine: "Basic Land — Island",
      cmc: 0,
      binders: [BINDER],
    },
    {
      id: randomUUID(),
      name: MOVE_CARD_NAME,
      colors: ["G"],
      typeLine: "Creature — Bear",
      cmc: 2,
      binders: [MOVE_FROM],
    },
    // Two stacks differing only in location: moving the first onto the
    // second collides on the stack unique index, which is the case KAD-21
    // has to surface rather than silently merge.
    {
      id: randomUUID(),
      name: CONFLICT_CARD_NAME,
      colors: ["W"],
      typeLine: "Creature — Wall",
      cmc: 2,
      binders: [CONFLICT_FROM, CONFLICT_TO],
    },
    {
      id: randomUUID(),
      name: TAG_CARD_NAME,
      colors: ["B"],
      typeLine: "Creature — Ogre",
      cmc: 3,
      binders: [TAG_BINDER],
    },
  ];

  // Garbage-collect fixtures from *previous* runs. Unique names are enough
  // for row counts, but the binder-location facet is a global list capped at
  // 50 entries (KAD-21): left to accumulate at four locations per run, this
  // run's chips would eventually fall off the end.
  //
  // Scoped by age, not just by `set_code = 'e2e'` (which only this file ever
  // writes), because `fullyParallel` means several workers seed their own
  // fixtures concurrently - deleting every e2e row would delete theirs.
  const staleBefore = now - 60 * 60 * 1000;
  db.prepare(
    `DELETE FROM collection_items WHERE scryfall_id IN (
       SELECT id FROM cards WHERE set_code = 'e2e' AND created_at < ?
     )`,
  ).run(staleBefore);
  db.prepare(`DELETE FROM cards WHERE set_code = 'e2e' AND created_at < ?`).run(staleBefore);

  const insertCard = db.prepare(
    `INSERT INTO cards (
       id, oracle_id, name, layout, mana_cost, cmc, type_line, oracle_text,
       colors, color_identity, keywords, legalities, games, reserved,
       set_code, set_name, set_type, collector_number, rarity, released_at,
       artist, border_color, frame, full_art, textless, promo, variation,
       finishes, card_faces, image_uris, scryfall_uri, prices,
       created_at, updated_at
     ) VALUES (
       @id, @oracleId, @name, 'normal', '{R}', @cmc, @typeLine, 'E2E fixture card.',
       @colors, @colors, '[]', '{}', '["paper"]', 0,
       'e2e', 'E2E Test Set', 'expansion', @collectorNumber, 'common', '2026-01-01',
       'E2E Artist', 'black', '2015', 0, 0, 0, 0,
       '["nonfoil"]', NULL, @imageUris, 'https://scryfall.com/e2e', '{}',
       @now, @now
     )`,
  );

  const insertItem = db.prepare(
    `INSERT INTO collection_items (
       id, scryfall_id, finish, condition, quantity, is_proxy,
       binder_location, language, created_at, updated_at
     ) VALUES (@id, @scryfallId, 'nonfoil', 'NM', 2, 0, @binder, 'en', @now, @now)`,
  );

  db.transaction(() => {
    for (const [index, card] of cards.entries()) {
      insertCard.run({
        id: card.id,
        oracleId: randomUUID(),
        name: card.name,
        cmc: card.cmc,
        typeLine: card.typeLine,
        colors: JSON.stringify(card.colors),
        collectorNumber: `${NONCE}-${String(index)}`,
        // A full-card image: `art_crop`/`border_crop` would cut the artist
        // and copyright line, which is what AC4 forbids.
        imageUris: JSON.stringify({ small: "https://example.invalid/small.jpg" }),
        now,
      });
      for (const binder of card.binders) {
        insertItem.run({ id: randomUUID(), scryfallId: card.id, binder, now });
      }
    }
  })();

  db.close();
}

test.beforeAll(() => {
  seed();
});

test("searches the collection with the query syntax (AC2)", async ({ page }) => {
  // binder: scopes to this run's fixtures; c:r then filters within them.
  await page.goto(`/collection?q=${encodeURIComponent(`binder:${BINDER}`)}`);
  await expect(page.getByText(CARD_NAME)).toBeVisible();
  await expect(page.getByText(OTHER_CARD_NAME)).toBeVisible();

  await page.goto(`/collection?q=${encodeURIComponent(`binder:${BINDER} c:r`)}`);
  await expect(page.getByText(CARD_NAME)).toBeVisible();
  await expect(page.getByText(OTHER_CARD_NAME)).toHaveCount(0);

  await page.goto(`/collection?q=${encodeURIComponent(`binder:${BINDER} t:island`)}`);
  await expect(page.getByText(OTHER_CARD_NAME)).toBeVisible();
  await expect(page.getByText(CARD_NAME)).toHaveCount(0);
});

test("submitting the search box filters results (AC2)", async ({ page }) => {
  await page.goto("/collection");
  await page.getByLabel("Search collection").fill(`binder:${BINDER} cmc<=0`);
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByText(OTHER_CARD_NAME)).toBeVisible();
  await expect(page.getByText(CARD_NAME)).toHaveCount(0);
});

test("names the offending operator instead of a generic error (AC2/KAD-18)", async ({ page }) => {
  // Named, because Next's own route announcer is an unnamed role="alert".
  const alert = page.getByRole("alert", { name: "Search error" });

  await page.goto("/collection?q=banana%3Ayes");
  await expect(alert).toContainText("Unknown search operator");
  await expect(alert).toContainText("banana");

  // `tag:` used to be the one v1 operator that parsed but had no storage,
  // and it reported that distinctly. KAD-22 built the storage, so it must
  // now run like any other operator rather than raise anything at all.
  await page.goto("/collection?q=tag%3Acube");
  await expect(alert).toHaveCount(0);
});

test("toggles between grid and list views (AC1)", async ({ page }) => {
  await page.goto(`/collection?q=${encodeURIComponent(`binder:${BINDER}`)}`);

  // Default is grid; the toggle offers the other mode.
  await page.getByRole("link", { name: "List view" }).click();
  await expect(page).toHaveURL(/view=list/);
  // The query survives the toggle.
  await expect(page.getByText(CARD_NAME)).toBeVisible();
  // List view shows the type line, grid doesn't.
  await expect(page.getByText("Creature — Goblin")).toBeVisible();

  await page.getByRole("link", { name: "Grid view" }).click();
  await expect(page).not.toHaveURL(/view=list/);
  await expect(page.getByText(CARD_NAME)).toBeVisible();
});

test("does not clip the artist or copyright line on card images (AC4)", async ({ page }) => {
  await page.goto(`/collection?q=${encodeURIComponent(`binder:${BINDER}`)}`);
  const image = page.getByRole("img", { name: CARD_NAME });
  await expect(image).toBeVisible();

  // A cropped Scryfall variant cuts the card's bottom edge, where the
  // artist credit and copyright sit.
  const src = await image.getAttribute("src");
  expect(src).not.toContain("art_crop");
  expect(src).not.toContain("border_crop");

  // The rendered box must keep the card's full aspect ratio - a shorter
  // box than the natural ratio means the bottom edge is being clipped.
  const clipped = await image.evaluate((el: HTMLImageElement) => {
    const parent = el.parentElement;
    return {
      objectFit: getComputedStyle(el).objectFit,
      // Any ancestor hiding overflow while the image overflows it would
      // cut the credit line.
      overflowClipped:
        parent !== null && el.getBoundingClientRect().height > parent.clientHeight + 1,
    };
  });
  expect(clipped.objectFit).not.toBe("cover");
  expect(clipped.overflowClipped).toBe(false);
});

/** Mirrors `binderFieldLabel` - the seed's stacks are all nonfoil/NM/real. */
function binderField(cardName: string, location: string): string {
  return `Binder location for ${cardName} (nonfoil, NM, ${location})`;
}

test("edits a binder location and the binder: filter picks it up (KAD-21 AC1)", async ({
  page,
}) => {
  await page.goto(`/collection?q=${encodeURIComponent(`binder:${MOVE_FROM}`)}`);
  await expect(page.getByText(MOVE_CARD_NAME)).toBeVisible();

  await page.getByLabel(binderField(MOVE_CARD_NAME, MOVE_FROM)).fill(MOVE_TO);
  await page.getByRole("button", { name: "Save" }).click();

  // The redirect preserves the query, which no longer matches the stack -
  // the move really happened rather than being written to a detached copy.
  await expect(page.getByText(MOVE_CARD_NAME)).toHaveCount(0);

  await page.goto(`/collection?q=${encodeURIComponent(`binder:${MOVE_TO}`)}`);
  await expect(page.getByText(MOVE_CARD_NAME)).toBeVisible();
  await expect(page.getByLabel(binderField(MOVE_CARD_NAME, MOVE_TO))).toHaveValue(MOVE_TO);
});

test("refuses to merge two stacks and says so (KAD-21)", async ({ page }) => {
  await page.goto(`/collection?q=${encodeURIComponent(`binder:${CONFLICT_FROM}`)}`);
  await page.getByLabel(binderField(CONFLICT_CARD_NAME, CONFLICT_FROM)).fill(CONFLICT_TO);
  await page.getByRole("button", { name: "Save" }).click();

  const alert = page.getByRole("alert", { name: "Binder location conflict" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(CONFLICT_TO);

  // Nothing moved and nothing merged: both stacks are still where they were.
  await page.goto(`/collection?q=${encodeURIComponent(`binder:taken-${NONCE}`)}`);
  await expect(page.getByLabel(binderField(CONFLICT_CARD_NAME, CONFLICT_FROM))).toBeVisible();
  await expect(page.getByLabel(binderField(CONFLICT_CARD_NAME, CONFLICT_TO))).toBeVisible();
});

test("filters by location from the facet, and toggles back off (KAD-21)", async ({ page }) => {
  await page.goto("/collection");
  const facet = page.getByRole("navigation", { name: "Filter by binder location" });

  await facet.getByRole("link", { name: new RegExp(`^${CONFLICT_FROM} \\(`) }).click();
  await expect(page).toHaveURL(new RegExp(`q=binder%3A${CONFLICT_FROM}`));
  await expect(page.getByText(CONFLICT_CARD_NAME)).toBeVisible();
  // Something that is definitely in the collection but not in this location.
  await expect(page.getByText(OTHER_CARD_NAME)).toHaveCount(0);

  // The chip is a toggle: clicking the active one removes its term rather
  // than stacking a second copy.
  await facet.getByRole("link", { name: new RegExp(`^${CONFLICT_FROM} \\(`) }).click();
  await expect(page).toHaveURL(/\/collection$/);
});

test("tags a stack, filters by the tag, and untags it (KAD-22 AC2)", async ({ page }) => {
  await page.goto(`/collection?q=${encodeURIComponent(`binder:${TAG_BINDER}`)}`);
  const context = `${TAG_CARD_NAME} (${TAG_BINDER})`;

  // Deliberately mixed case on the way in: tags are stored normalized, so
  // the chip and the `tag:` term that finds it are both lowercase.
  await page.getByLabel(`Add a tag to ${context}`).fill(TAG.toUpperCase());
  await page.getByRole("button", { name: `Add tag to ${context}` }).click();
  await expect(
    page.getByRole("button", { name: `Remove tag ${TAG} from ${context}` }),
  ).toBeVisible();

  // AC2: applied, therefore filterable.
  await page.goto(`/collection?q=${encodeURIComponent(`tag:${TAG}`)}`);
  await expect(page.getByText(TAG_CARD_NAME)).toBeVisible();
  await expect(page.getByText(CARD_NAME)).toHaveCount(0);

  // The facet offers the tag it just learned about.
  const facet = page.getByRole("navigation", { name: "Filter by tag" });
  await expect(facet.getByRole("link", { name: new RegExp(`^${TAG} \\(`) })).toBeVisible();

  await page.getByRole("button", { name: `Remove tag ${TAG} from ${context}` }).click();
  await expect(page.getByText(TAG_CARD_NAME)).toHaveCount(0);
});

test("offers every export format, and flags the lossy one (KAD-23 AC1)", async ({ page }) => {
  await page.goto("/collection");
  const exports = page.getByRole("region", { name: "Export collection" });

  await expect(exports.getByRole("link", { name: "JSON" })).toBeVisible();
  await expect(exports.getByRole("link", { name: "CSV" })).toBeVisible();
  // The caveat is the point of the test: someone reaching for "export" is
  // quite likely reaching for a backup, and Moxfield text is not one.
  await expect(exports.getByRole("link", { name: "Moxfield text (lossy)" })).toBeVisible();
  await expect(exports.getByText(/Binder location, condition, proxy flag/)).toBeVisible();
});

/**
 * Fetched through the browser context rather than clicked, because the route
 * answers with `content-disposition: attachment` - the assertion worth making
 * is about the bytes and the headers, and a download event tells us neither.
 * This is also the only place the route's `connection()` call gets exercised
 * at all: per CLAUDE.md it throws outside a real Next request scope, so
 * Vitest cannot reach it by invoking `GET`.
 */
test("downloads the collection in each format (KAD-23 AC1)", async ({ page }) => {
  await page.goto("/collection");

  const json = await page.request.get("/api/export?format=json");
  expect(json.status()).toBe(200);
  expect(json.headers()["content-type"]).toContain("application/json");
  expect(json.headers()["content-disposition"]).toMatch(
    /attachment; filename="mtg-collection-\d{4}-\d{2}-\d{2}\.json"/,
  );
  // Matched structurally rather than cast to a local interface: the shape is
  // the route's contract, and restating it here as a type assertion would
  // assert nothing about what actually came back.
  const file: unknown = JSON.parse(await json.text());
  expect(file).toMatchObject({
    version: 1,
    // The lossless format carries the fields the CSV shape had to be taught:
    // this stack exists at a binder location, and that has to survive.
    items: expect.arrayContaining([
      expect.objectContaining({ name: CARD_NAME, binderLocation: BINDER }),
    ]),
  });

  const csv = await page.request.get("/api/export?format=csv");
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const csvText = await csv.text();
  expect(csvText).toContain(CARD_NAME);
  expect(csvText).toContain(BINDER);

  const moxfield = await page.request.get("/api/export?format=moxfield");
  expect(moxfield.headers()["content-type"]).toContain("text/plain");
  expect(await moxfield.text()).toContain(CARD_NAME);

  const bad = await page.request.get("/api/export?format=nonsense");
  expect(bad.status()).toBe(400);
});

test("round-trips an exported collection back in through the API (KAD-23 AC2)", async ({
  page,
}) => {
  await page.goto("/collection");
  const jsonText = await (await page.request.get("/api/export?format=json")).text();

  // Re-importing into the *same* database merges rather than duplicating -
  // `createOrMergeCollectionItem` semantics - so the assertion here is that
  // the file is accepted and every row is understood, not that the
  // collection is unchanged. Losslessness against a fresh database is what
  // the round-trip contract test in `server/export/` proves.
  const response = await page.request.post("/api/import/collection", { data: { jsonText } });
  expect(response.status()).toBe(201);
  const body: unknown = await response.json();
  // Nothing skipped is the real assertion: every row the export wrote was
  // understood on the way back in.
  expect(body).toMatchObject({ imported: expect.any(Number), skipped: [] });
});

test("keeps the primary controls in the lower third on phone width (NFR-7)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/collection");

  const box = await page.getByLabel("Search collection").boundingBox();
  if (box === null) throw new Error("search box is not rendered at phone width");
  // Lower third of an 844px-tall viewport starts at ~563px.
  expect(box.y).toBeGreaterThan(844 * (2 / 3));
});
