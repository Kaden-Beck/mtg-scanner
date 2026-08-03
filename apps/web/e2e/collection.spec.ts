import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

/**
 * Unlike the reconciliation spec - where the import pipeline *was* the
 * thing under test, so it seeded through the real API - the subject here is
 * the browse page. Seeding a printing plus an owned stack straight into the
 * dev server's SQLite file is the only way to get deterministic rows
 * without a full 110k-row Scryfall sync. WAL mode (db/client.ts) makes the
 * concurrent write safe while the dev server holds its own connection.
 *
 * The dev server runs with cwd = apps/web, so its default DATABASE_PATH is
 * apps/web/data/mtg.db.
 *
 * Resolved from `process.cwd()`, not `import.meta.dirname`: Playwright
 * transpiles specs to CJS, where `import.meta` is a hard SyntaxError at
 * load time. `playwright test` runs from the repo root - the same
 * assumption the config's own relative `testDir` already makes.
 */
const DB_PATH =
  process.env["DATABASE_PATH"] ?? path.join(process.cwd(), "apps", "web", "data", "mtg.db");

// Unique per run: the dev server's DB persists between runs, so a fixed
// name would accumulate rows and make count assertions drift.
const NONCE = randomUUID().slice(0, 8);
const CARD_NAME = `E2E Goblin ${NONCE}`;
const OTHER_CARD_NAME = `E2E Island ${NONCE}`;
const BINDER = `e2e-${NONCE}`;

interface SeedCard {
  readonly id: string;
  readonly name: string;
  readonly colors: string[];
  readonly typeLine: string;
  readonly cmc: number;
}

function seed(): void {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  const now = Date.now();

  const cards: SeedCard[] = [
    { id: randomUUID(), name: CARD_NAME, colors: ["R"], typeLine: "Creature — Goblin", cmc: 1 },
    {
      id: randomUUID(),
      name: OTHER_CARD_NAME,
      colors: ["U"],
      typeLine: "Basic Land — Island",
      cmc: 0,
    },
  ];

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
     ) VALUES (@id, @scryfallId, 'nonfoil', 'nm', 2, 0, @binder, 'en', @now, @now)`,
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
      insertItem.run({ id: randomUUID(), scryfallId: card.id, binder: BINDER, now });
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

  // `tag:` is real v1 grammar the compiler defers to Sprint 4 - a distinct
  // message from "never heard of it".
  await page.goto("/collection?q=tag%3Acube");
  await expect(alert).toContainText("Sprint 4");
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

test("keeps the primary controls in the lower third on phone width (NFR-7)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/collection");

  const box = await page.getByLabel("Search collection").boundingBox();
  if (box === null) throw new Error("search box is not rendered at phone width");
  // Lower third of an 844px-tall viewport starts at ~563px.
  expect(box.y).toBeGreaterThan(844 * (2 / 3));
});
