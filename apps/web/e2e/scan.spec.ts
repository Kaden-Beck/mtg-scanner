import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { E2E_DATABASE_PATH } from "./db-path";

/**
 * Bulk scan session (KAD-49): defaults → manual resolve → commit → list → undo.
 * Uses manual lookup instead of camera/OCR so the smoke stays deterministic.
 */

const DB_PATH = E2E_DATABASE_PATH;
const NONCE = randomUUID().slice(0, 8);
const CARD_ID = randomUUID();
const CARD_NAME = `E2E Scan ${NONCE}`;
const SET_CODE = "e2e";
const COLLECTOR = `s${NONCE}`;
const BINDER = `scan-box-${NONCE}`;

test.beforeAll(() => {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  const now = Date.now();
  db.prepare(
    `INSERT INTO cards (
       id, oracle_id, name, layout, mana_cost, cmc, type_line, oracle_text,
       colors, color_identity, keywords, legalities, games, reserved,
       set_code, set_name, set_type, collector_number, rarity, released_at,
       artist, border_color, frame, full_art, textless, promo, variation,
       finishes, card_faces, image_uris, scryfall_uri, prices, created_at, updated_at
     ) VALUES (
       ?, NULL, ?, 'normal', '', 0, 'Creature — Test', NULL,
       '[]', '[]', '[]', '{}', '["paper"]', 0,
       ?, 'E2E Set', 'token', ?, 'common', '2026-01-01',
       NULL, 'black', '2015', 0, 0, 0, 0,
       '["nonfoil","foil"]', NULL, NULL, 'https://scryfall.com/e2e', '{}', ?, ?
     )`,
  ).run(CARD_ID, CARD_NAME, SET_CODE, COLLECTOR, now, now);

  // FTS so nothing else breaks if a later test searches — scan itself uses set+cn.
  db.prepare(
    `INSERT INTO cards_fts(rowid, name, oracle_text, type_line)
     SELECT rowid, name, coalesce(oracle_text, ''), type_line FROM cards WHERE id = ?`,
  ).run(CARD_ID);
  db.close();
});

test("scan session: commit with defaults, list, and undo", async ({ page }) => {
  await page.goto("/scan");

  await expect(page.getByRole("heading", { name: "Scan" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Session defaults" })).toBeVisible();

  await page.getByLabel("Binder location").fill(BINDER);
  await page.getByLabel("Condition").selectOption("LP");

  await page.getByLabel("Set code").fill(SET_CODE);
  await page.getByLabel("Collector number").fill(COLLECTOR);
  await page.getByRole("button", { name: "Look up" }).click();

  const confirm = page.getByRole("region", { name: "Confirm scanned card" });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("heading", { name: CARD_NAME })).toBeVisible();
  await expect(confirm.getByText(/LP/)).toBeVisible();

  await page.getByRole("button", { name: "Add to collection" }).click();

  const list = page.getByRole("region", { name: "Session commits" });
  await expect(list).toBeVisible();
  await expect(list.getByText(CARD_NAME)).toBeVisible();
  await expect(list.getByText(/LP/)).toBeVisible();

  await page.getByRole("button", { name: `Undo ${CARD_NAME}` }).click();
  await expect(list).toHaveCount(0);

  const db = new Database(DB_PATH, { readonly: true });
  const remaining = db
    .prepare(
      `SELECT count(*) AS n FROM collection_items WHERE scryfall_id = ? AND binder_location = ?`,
    )
    .get(CARD_ID, BINDER);
  db.close();
  expect(remaining).toEqual({ n: 0 });
});
