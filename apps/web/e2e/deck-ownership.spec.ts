import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { E2E_DATABASE_PATH } from "./db-path";

/**
 * Ownership overlay on deck lists (KAD-32), plus the binder location display
 * descoped from KAD-21 AC2.
 *
 * Own fixture set and own `set_code` ('e2eo') so its GC never competes with
 * the deck editor spec's. The cards here differ in exactly the dimensions
 * ownership reads - oracle id, price, and how many copies sit in
 * `collection_items` - rather than in the legality dimensions the other spec
 * cares about.
 */
const DB_PATH = E2E_DATABASE_PATH;
const SET_CODE = "e2eo";

const NONCE = randomUUID().slice(0, 8);
const COMMANDER = `E2E Own Cmdr ${NONCE}`;
const FULLY_OWNED = `E2E Owned ${NONCE}`;
const PARTIAL = `E2E Partial ${NONCE}`;
const UNOWNED = `E2E Unowned ${NONCE}`;
const REPRINT = `E2E Reprint ${NONCE}`;
const DECK_NAME = `E2E Own Deck ${NONCE}`;
/**
 * Owned, and claimed by a deck that is not under test.
 *
 * Has its own card and its own stack purely so the owned-only ADR-004 test
 * can create a competing claim without polluting the KAD-33 conflict test,
 * which asserts on the exact set of competing deck names. Sharing one stack
 * made the two tests order-dependent.
 */
const CLAIMED = `E2E Claimed ${NONCE}`;

// Two printings share this oracle id: the deck names printing A, the
// collection holds printing B. Oracle-level matching is what makes that
// "owned" rather than a shopping-list entry.
const REPRINT_ORACLE = randomUUID();

interface SeedCard {
  readonly id: string;
  readonly name: string;
  readonly oracleId: string | null;
  readonly prices: string;
}

const commanderCard: SeedCard = {
  id: randomUUID(),
  name: COMMANDER,
  oracleId: randomUUID(),
  prices: "{}",
};
const ownedCard: SeedCard = {
  id: randomUUID(),
  name: FULLY_OWNED,
  oracleId: randomUUID(),
  prices: '{"usd":"1.00"}',
};
const partialCard: SeedCard = {
  id: randomUUID(),
  name: PARTIAL,
  oracleId: randomUUID(),
  prices: '{"usd":"2.50"}',
};
const unownedCard: SeedCard = {
  id: randomUUID(),
  name: UNOWNED,
  oracleId: randomUUID(),
  prices: '{"usd":"10.00"}',
};
/** The printing the deck asks for. */
const reprintWanted: SeedCard = {
  id: randomUUID(),
  name: REPRINT,
  oracleId: REPRINT_ORACLE,
  prices: '{"usd":"5.00"}',
};
/** The printing actually in the box - same oracle card, different art. */
const reprintOwned: SeedCard = {
  id: randomUUID(),
  name: REPRINT,
  oracleId: REPRINT_ORACLE,
  prices: '{"usd":"7.00"}',
};

const claimedCard: SeedCard = {
  id: randomUUID(),
  name: CLAIMED,
  oracleId: randomUUID(),
  prices: '{"usd":"3.00"}',
};

const SEED_CARDS = [
  commanderCard,
  ownedCard,
  partialCard,
  unownedCard,
  reprintWanted,
  reprintOwned,
  claimedCard,
];

function seed(): void {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  const now = Date.now();

  // Age-scoped GC, same as the other specs: only fixtures old enough to
  // belong to a previous run, never a concurrent worker's.
  const staleBefore = now - 60 * 60 * 1000;
  const stale = `SELECT id FROM cards WHERE set_code = '${SET_CODE}' AND created_at < ?`;
  db.prepare(`DELETE FROM deck_cards WHERE scryfall_id IN (${stale})`).run(staleBefore);
  db.prepare(`DELETE FROM collection_items WHERE scryfall_id IN (${stale})`).run(staleBefore);
  db.prepare(`DELETE FROM decks WHERE commander_card_id IN (${stale})`).run(staleBefore);
  db.prepare(`DELETE FROM cards WHERE set_code = '${SET_CODE}' AND created_at < ?`).run(
    staleBefore,
  );

  const insertCard = db.prepare(
    `INSERT INTO cards (
       id, oracle_id, name, layout, mana_cost, cmc, type_line, oracle_text,
       colors, color_identity, keywords, legalities, games, reserved,
       set_code, set_name, set_type, collector_number, rarity, released_at,
       artist, border_color, frame, full_art, textless, promo, variation,
       finishes, card_faces, image_uris, scryfall_uri, prices,
       created_at, updated_at
     ) VALUES (
       @id, @oracleId, @name, 'normal', '{1}', 1, 'Artifact', 'E2E ownership fixture.',
       '[]', '[]', '[]', '{"commander":"legal"}', '["paper"]', 0,
       '${SET_CODE}', 'E2E Ownership Set', 'expansion', @collectorNumber, 'common', '2026-01-01',
       'E2E Artist', 'black', '2015', 0, 0, 0, 0,
       '["nonfoil"]', NULL, NULL, 'https://scryfall.com/e2e', @prices,
       @now, @now
     )`,
  );

  // The typeahead reads `cards_fts`, which the ingest normally populates -
  // a direct INSERT INTO cards does not reach it, so KAD-35's owned-only
  // test would find nothing in either mode without this.
  const insertFts = db.prepare(
    `INSERT INTO cards_fts (rowid, name, type_line, oracle_text)
     SELECT rowid, name, type_line, oracle_text FROM cards WHERE id = ?`,
  );

  const run = db.transaction(() => {
    SEED_CARDS.forEach((card, index) => {
      insertCard.run({
        id: card.id,
        oracleId: card.oracleId,
        name: card.name,
        prices: card.prices,
        collectorNumber: `${NONCE}-${String(index)}`,
        now,
      });
      insertFts.run(card.id);
    });
  });
  run();
  db.close();
}

/** The stack holding the single copy of FULLY_OWNED - the one two decks
 *  fight over in the conflict test. */
let ownedStackId = "";

/** The stack behind CLAIMED - used only by the owned-only ADR-004 test. */
let claimedStackId = "";

/** Puts physical copies in the collection. */
function seedStacks(): void {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  const now = Date.now();

  const insert = db.prepare(
    `INSERT INTO collection_items (
       id, scryfall_id, finish, condition, quantity, is_proxy,
       binder_location, language, created_at, updated_at
     ) VALUES (?, ?, 'nonfoil', 'NM', ?, 0, ?, 'en', ?, ?)`,
  );

  ownedStackId = randomUUID();
  claimedStackId = randomUUID();
  const run = db.transaction(() => {
    insert.run(ownedStackId, ownedCard.id, 1, `Binder ${NONCE}`, now, now);
    insert.run(claimedStackId, claimedCard.id, 1, `Binder ${NONCE}`, now, now);
    // 1 of the 4 the deck wants.
    insert.run(randomUUID(), partialCard.id, 1, `Binder ${NONCE}`, now, now);
    // The *other* printing of the reprinted card.
    insert.run(randomUUID(), reprintOwned.id, 1, `Deck box ${NONCE}`, now, now);
  });
  run();
  db.close();
}

/**
 * Allocation rows, written directly.
 *
 * The specs seed decks through SQL rather than the UI, which skips the
 * `syncDeckAllocations` call on the real write path - so without this the
 * allocation table stays empty and no conflict could ever appear. These rows
 * are exactly what that function would have produced.
 */
function allocate(deckId: string, collectionItemId: string, quantity: number): void {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  const now = Date.now();
  db.prepare(
    `INSERT INTO deck_allocations (id, deck_id, collection_item_id, quantity, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), deckId, collectionItemId, quantity, now, now);
  db.close();
}

/** A second deck claiming one physical copy of `card`, defaulting to the
 *  single copy of FULLY_OWNED. */
function seedCompetingDeck(
  name: string,
  card: SeedCard = ownedCard,
  stackId: string = ownedStackId,
): string {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  const now = Date.now();
  const deckId = randomUUID();

  db.prepare(
    `INSERT INTO decks (id, name, format, description, commander_card_id, partner_card_id, created_at, updated_at)
     VALUES (?, ?, 'commander', '', ?, NULL, ?, ?)`,
  ).run(deckId, name, commanderCard.id, now, now);

  db.prepare(
    `INSERT INTO deck_cards (id, deck_id, scryfall_id, board, category, quantity, created_at, updated_at)
     VALUES (?, ?, ?, 'main', '', 1, ?, ?)`,
  ).run(randomUUID(), deckId, card.id, now, now);
  db.close();

  allocate(deckId, stackId, 1);
  return deckId;
}

function seedDeck(): string {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  const now = Date.now();
  const deckId = randomUUID();

  db.prepare(
    `INSERT INTO decks (id, name, format, description, commander_card_id, partner_card_id, created_at, updated_at)
     VALUES (?, ?, 'commander', '', ?, NULL, ?, ?)`,
  ).run(deckId, DECK_NAME, commanderCard.id, now, now);

  const insertEntry = db.prepare(
    `INSERT INTO deck_cards (id, deck_id, scryfall_id, board, category, quantity, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertEntry.run(randomUUID(), deckId, ownedCard.id, "main", "artifacts", 1, now, now);
  insertEntry.run(randomUUID(), deckId, partialCard.id, "main", "artifacts", 4, now, now);
  insertEntry.run(randomUUID(), deckId, unownedCard.id, "main", "artifacts", 1, now, now);
  insertEntry.run(randomUUID(), deckId, reprintWanted.id, "main", "artifacts", 1, now, now);

  db.close();
  // Deliberately does *not* allocate. Every test seeds its own deck, and if
  // this claimed the shared stack then five decks would pile onto one copy
  // and the conflict tests would drift as tests were added.
  return deckId;
}

test.beforeAll(() => {
  seed();
  seedStacks();
});

test("marks each card owned, partially owned or not owned (AC1)", async ({ page }) => {
  const deckId = seedDeck();
  await page.goto(`/decks/${deckId}`);

  await expect(page.getByRole("heading", { name: DECK_NAME })).toBeVisible();

  // The badge's accessible text spells the status out - the visual "1/4" is
  // aria-hidden, because colour is the only thing separating the states.
  await expect(page.getByText(`${FULLY_OWNED}: owned, 1 of 1 needed`)).toBeVisible();
  await expect(page.getByText(`${PARTIAL}: partially owned, 1 of 4 needed`)).toBeVisible();
  await expect(page.getByText(`${UNOWNED}: not owned`)).toBeVisible();
});

test("counts a different printing of the same card as owned", async ({ page }) => {
  const deckId = seedDeck();
  await page.goto(`/decks/${deckId}`);

  // Deck names one printing, box holds another. Printing-level matching would
  // send the user shopping for a card they already have.
  await expect(page.getByText(`${REPRINT}: owned, 1 of 1 needed`)).toBeVisible();
  await expect(page.getByText(`Deck box ${NONCE} · different printing`)).toBeVisible();
});

test("shows where each owned copy is stored (KAD-21 AC2)", async ({ page }) => {
  const deckId = seedDeck();
  await page.goto(`/decks/${deckId}`);

  await expect(page.getByText(`Binder ${NONCE}`).first()).toBeVisible();
});

test("summarizes the count and estimated cost of unowned cards (AC3)", async ({ page }) => {
  const deckId = seedDeck();
  await page.goto(`/decks/${deckId}`);

  const summary = page.getByRole("region", { name: "Deck ownership summary" });
  await expect(summary).toBeVisible();

  // 3 copies of PARTIAL missing at $2.50 = $7.50, plus 1 UNOWNED at $10.00.
  // The fully-owned and reprint-owned cards contribute nothing.
  await expect(summary).toContainText("2 cards missing");
  await expect(summary).toContainText("4 copies");
  await expect(summary).toContainText("$17.50");
});

test("owned-only mode restricts the typeahead to owned cards (KAD-35 AC1)", async ({ page }) => {
  const deckId = seedDeck();
  await page.goto(`/decks/${deckId}`);

  const results = page.getByRole("list", { name: "Card search results" });

  // Off: the unowned card is offered, because the full catalogue is.
  await page.getByLabel("Add a card").fill(UNOWNED);
  await expect(results.getByRole("button", { name: new RegExp(UNOWNED) })).toBeVisible();

  // On: it disappears. Note the term is unchanged - flipping the toggle has
  // to re-run the search, not wait for the next keystroke.
  await page.getByLabel("Owned only").check();
  await expect(results.getByRole("button", { name: new RegExp(UNOWNED) })).toHaveCount(0);

  // ...and an owned card survives the filter, with its availability shown.
  await page.getByLabel("Add a card").fill(FULLY_OWNED);
  await expect(results.getByRole("button", { name: new RegExp(FULLY_OWNED) })).toBeVisible();
  await expect(results).toContainText("1 owned");
});

test("owned-only still offers a card another deck has claimed (ADR-004)", async ({ page }) => {
  // Advisory allocation: the copy is spoken for, but excluding it would
  // enforce a reservation the rest of the app deliberately does not.
  const deckId = seedDeck();
  // Its own card and stack, so this claim cannot leak into the KAD-33 test's
  // assertion about exactly which decks are competing.
  seedCompetingDeck(`E2E Claimer ${randomUUID().slice(0, 8)}`, claimedCard, claimedStackId);

  await page.goto(`/decks/${deckId}`);
  await page.getByLabel("Owned only").check();
  await page.getByLabel("Add a card").fill(CLAIMED);

  const results = page.getByRole("list", { name: "Card search results" });
  await expect(results.getByRole("button", { name: new RegExp(CLAIMED) })).toBeVisible();
  // Shown as spent rather than hidden.
  await expect(results).toContainText("0 free");
});

test("names the competing deck when two decks want the same copy (KAD-33 AC2)", async ({
  page,
}) => {
  // Both decks claim the single physical copy of FULLY_OWNED. Under ADR-004
  // neither edit is refused, so this warning is the only thing that tells the
  // user the two decks cannot both be sleeved up.
  const first = seedDeck();
  allocate(first, ownedStackId, 1);
  const competitorName = `E2E Rival ${randomUUID().slice(0, 8)}`;
  seedCompetingDeck(competitorName);

  await page.goto(`/decks/${first}`);

  await expect(page.getByText(`Also in ${competitorName}`)).toBeVisible();
  await expect(
    page.getByText(`${FULLY_OWNED}: short 1 copy, also allocated to ${competitorName}`),
  ).toBeVisible();

  const summary = page.getByRole("region", { name: "Deck allocation conflicts" });
  await expect(summary).toContainText("1 card also allocated to another deck");
});
