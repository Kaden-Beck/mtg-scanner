import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { E2E_DATABASE_PATH } from "./db-path";

/**
 * Deck editor and legality report (KAD-27, KAD-31).
 *
 * Seeds printings straight into the e2e SQLite file, same approach and same
 * reasoning as the collection spec: the subject here is the deck page, not
 * the ingest, and a real Scryfall sync is not a fixture.
 *
 * The cards are chosen to trip specific rules rather than to look realistic:
 * a mono-green commander, an off-identity blue card, a banned card, and a
 * basic land that must stay singleton-exempt at 30 copies.
 */
const DB_PATH = E2E_DATABASE_PATH;

// Unique per run - the e2e database persists between runs, so fixed names
// would accumulate and make assertions drift.
const NONCE = randomUUID().slice(0, 8);
const COMMANDER = `E2E Yeva ${NONCE}`;
const IN_IDENTITY = `E2E Elves ${NONCE}`;
const OFF_IDENTITY = `E2E Counterspell ${NONCE}`;
const BANNED = `E2E Lotus ${NONCE}`;
const BASIC = `E2E Forest ${NONCE}`;
const DECK_NAME = `E2E Deck ${NONCE}`;

interface SeedCard {
  readonly id: string;
  readonly name: string;
  readonly colorIdentity: string[];
  readonly typeLine: string;
  readonly legalities: string;
  readonly oracleText: string;
}

const SEED_CARDS: SeedCard[] = [
  {
    id: randomUUID(),
    name: COMMANDER,
    colorIdentity: ["G"],
    typeLine: "Legendary Creature — Elf Shaman",
    legalities: '{"commander":"legal"}',
    oracleText: "E2E commander fixture.",
  },
  {
    id: randomUUID(),
    name: IN_IDENTITY,
    colorIdentity: ["G"],
    typeLine: "Creature — Elf Druid",
    legalities: '{"commander":"legal"}',
    oracleText: "E2E in-identity fixture.",
  },
  {
    id: randomUUID(),
    name: OFF_IDENTITY,
    colorIdentity: ["U"],
    typeLine: "Instant",
    legalities: '{"commander":"legal"}',
    oracleText: "E2E off-identity fixture.",
  },
  {
    id: randomUUID(),
    name: BANNED,
    colorIdentity: [],
    typeLine: "Artifact",
    legalities: '{"commander":"banned"}',
    oracleText: "E2E banned fixture.",
  },
  {
    id: randomUUID(),
    name: BASIC,
    colorIdentity: ["G"],
    typeLine: "Basic Land — Forest",
    legalities: '{"commander":"legal"}',
    oracleText: "E2E basic land fixture.",
  },
];

function seed(): void {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  const now = Date.now();

  // Same age-scoped GC as the collection spec: delete only fixtures old
  // enough to belong to a previous run, never a concurrent worker's.
  const staleBefore = now - 60 * 60 * 1000;
  db.prepare(
    `DELETE FROM deck_cards WHERE scryfall_id IN (
       SELECT id FROM cards WHERE set_code = 'e2ed' AND created_at < ?
     )`,
  ).run(staleBefore);
  db.prepare(
    `DELETE FROM decks WHERE commander_card_id IN (
       SELECT id FROM cards WHERE set_code = 'e2ed' AND created_at < ?
     )`,
  ).run(staleBefore);
  db.prepare(`DELETE FROM cards WHERE set_code = 'e2ed' AND created_at < ?`).run(staleBefore);

  const insertCard = db.prepare(
    `INSERT INTO cards (
       id, oracle_id, name, layout, mana_cost, cmc, type_line, oracle_text,
       colors, color_identity, keywords, legalities, games, reserved,
       set_code, set_name, set_type, collector_number, rarity, released_at,
       artist, border_color, frame, full_art, textless, promo, variation,
       finishes, card_faces, image_uris, scryfall_uri, prices,
       created_at, updated_at
     ) VALUES (
       @id, NULL, @name, 'normal', '{G}', 1, @typeLine, @oracleText,
       '[]', @colorIdentity, '[]', @legalities, '["paper"]', 0,
       'e2ed', 'E2E Deck Set', 'expansion', @collectorNumber, 'common', '2026-01-01',
       'E2E Artist', 'black', '2015', 0, 0, 0, 0,
       '["nonfoil"]', NULL, NULL, 'https://scryfall.com/e2e', '{}',
       @now, @now
     )`,
  );

  const insertFts = db.prepare(
    `INSERT INTO cards_fts (rowid, name, type_line, oracle_text)
     SELECT rowid, name, type_line, oracle_text FROM cards WHERE id = ?`,
  );

  const run = db.transaction(() => {
    SEED_CARDS.forEach((card, index) => {
      insertCard.run({
        id: card.id,
        name: card.name,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
        colorIdentity: JSON.stringify(card.colorIdentity),
        legalities: card.legalities,
        collectorNumber: `${NONCE}-${String(index)}`,
        now,
      });
      // The typeahead reads the FTS table, which the ingest normally
      // populates - a direct INSERT into `cards` does not reach it.
      insertFts.run(card.id);
    });
  });
  run();
  db.close();
}

/** Creates the deck and its cards through SQL rather than the UI, so each
 * test starts from a known deck without re-driving the editor. */
function seedDeck(): string {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  const now = Date.now();
  const deckId = randomUUID();
  const commander = SEED_CARDS[0];
  if (!commander) throw new Error("expected a commander fixture");

  db.prepare(
    `INSERT INTO decks (id, name, format, description, commander_card_id, partner_card_id, created_at, updated_at)
     VALUES (?, ?, 'commander', '', ?, NULL, ?, ?)`,
  ).run(deckId, DECK_NAME, commander.id, now, now);

  const insertEntry = db.prepare(
    `INSERT INTO deck_cards (id, deck_id, scryfall_id, board, category, quantity, created_at, updated_at)
     VALUES (?, ?, ?, 'main', ?, ?, ?, ?)`,
  );
  const [, inIdentity, offIdentity, banned, basic] = SEED_CARDS;
  if (!inIdentity || !offIdentity || !banned || !basic) {
    throw new Error("expected the full fixture set");
  }

  insertEntry.run(randomUUID(), deckId, inIdentity.id, "ramp", 1, now, now);
  insertEntry.run(randomUUID(), deckId, offIdentity.id, "removal", 1, now, now);
  insertEntry.run(randomUUID(), deckId, banned.id, "ramp", 1, now, now);
  // 30 copies of a basic land: must NOT trip singleton.
  insertEntry.run(randomUUID(), deckId, basic.id, "lands", 30, now, now);

  db.close();
  return deckId;
}

test.beforeAll(() => {
  seed();
});

test("groups deck cards by user-defined category", async ({ page }) => {
  const deckId = seedDeck();
  await page.goto(`/decks/${deckId}`);

  await expect(page.getByRole("heading", { name: DECK_NAME })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^ramp/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^removal/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^lands/ })).toBeVisible();

  await expect(page.getByText(`1× ${IN_IDENTITY}`)).toBeVisible();
  await expect(page.getByText(`30× ${BASIC}`)).toBeVisible();
});

test("reports the specific card and rule for each violation (KAD-31 AC2)", async ({ page }) => {
  const deckId = seedDeck();
  await page.goto(`/decks/${deckId}`);

  // Selected by name, because Next renders its own role="alert" route
  // announcer on every page - an unnamed alert is always ambiguous.
  const verdict = page.getByRole("alert", { name: "Deck legality" });
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText("not legal for Commander");
  // Never just "illegal" - it counts the problems and the rules.
  await expect(verdict).toContainText("problems across");

  await expect(page.getByRole("heading", { name: /Banned or not legal/ })).toBeVisible();
  await expect(page.getByText(`${BANNED} is banned in Commander.`)).toBeVisible();

  await expect(page.getByRole("heading", { name: /Color identity/ })).toBeVisible();
  await expect(page.getByText(new RegExp(`${OFF_IDENTITY}.*outside the commander's G`))).toBeVisible();
});

test("exempts basic lands from the singleton rule", async ({ page }) => {
  const deckId = seedDeck();
  await page.goto(`/decks/${deckId}`);

  // 30 copies of a basic land is present in the list but must produce no
  // singleton violation naming it.
  await expect(page.getByText(`30× ${BASIC}`)).toBeVisible();
  await expect(page.getByText(new RegExp(`copies of ${BASIC}`))).toHaveCount(0);
});

test("adds a card via search-as-you-type", async ({ page }) => {
  const deckId = seedDeck();
  await page.goto(`/decks/${deckId}`);

  await page.getByLabel("Add a card").fill(IN_IDENTITY);

  // Scoped to the results list. Unscoped, `name: /E2E Elves .../` also
  // matches the deck list's "Remove E2E Elves ..." button - the first run of
  // this spec clicked that instead and "selected" the card by deleting it.
  const suggestion = page
    .getByRole("list", { name: "Card search results" })
    .getByRole("button", { name: new RegExp(IN_IDENTITY) });
  await expect(suggestion).toBeVisible();
  await suggestion.click();

  await expect(page.getByLabel("Selected card")).toContainText(IN_IDENTITY);
  await page.getByLabel("Category", { exact: true }).fill("ramp");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  // Merged into the existing entry rather than forking it - deck_cards is
  // unique on (deck, printing, board).
  await expect(page.getByText(`2× ${IN_IDENTITY}`)).toBeVisible();
});

test("removes a card from the deck", async ({ page }) => {
  const deckId = seedDeck();
  await page.goto(`/decks/${deckId}`);

  await expect(page.getByText(`1× ${OFF_IDENTITY}`)).toBeVisible();
  await page.getByRole("button", { name: `Remove ${OFF_IDENTITY}` }).click();

  await expect(page.getByText(`1× ${OFF_IDENTITY}`)).toHaveCount(0);
  // ...and the color-identity violation it caused goes with it.
  await expect(
    page.getByText(new RegExp(`${OFF_IDENTITY}.*outside the commander's`)),
  ).toHaveCount(0);
});

test("is readable on a phone viewport without horizontal scrolling", async ({ page }) => {
  // The pre-game check context in the AC: read-only review on a phone.
  const deckId = seedDeck();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/decks/${deckId}`);

  await expect(page.getByRole("heading", { name: DECK_NAME })).toBeVisible();
  await expect(page.getByText(`30× ${BASIC}`)).toBeVisible();

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows).toBe(false);
});
