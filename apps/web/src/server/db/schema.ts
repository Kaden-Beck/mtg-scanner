import type { Condition, Finish } from "@mtg/schemas";
import {
  blob,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * One row per Scryfall printing (not per oracle card - reprints get
 * separate rows sharing an oracle_id). Shape follows the Scryfall "default
 * cards" bulk object; see KAD-8 for the ingest job that populates this from
 * the Zod-validated boundary in packages/schemas.
 */
export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey(), // ScryfallId
    // Nullable: reversible_card layout keeps oracle_id per-face, not top-level.
    oracleId: text("oracle_id"),
    name: text("name").notNull(),
    layout: text("layout").notNull(),
    manaCost: text("mana_cost"),
    cmc: real("cmc").notNull(),
    typeLine: text("type_line").notNull(),
    oracleText: text("oracle_text"),
    colors: text("colors", { mode: "json" }).$type<string[]>(),
    colorIdentity: text("color_identity", { mode: "json" }).$type<string[]>().notNull(),
    keywords: text("keywords", { mode: "json" }).$type<string[]>().notNull(),
    legalities: text("legalities", { mode: "json" }).$type<Record<string, string>>().notNull(),
    games: text("games", { mode: "json" }).$type<string[]>().notNull(),
    reserved: integer("reserved", { mode: "boolean" }).notNull(),

    setCode: text("set_code").notNull(),
    setName: text("set_name").notNull(),
    setType: text("set_type").notNull(),
    collectorNumber: text("collector_number").notNull(),
    rarity: text("rarity").notNull(),
    releasedAt: text("released_at").notNull(),

    artist: text("artist"),
    borderColor: text("border_color").notNull(),
    frame: text("frame").notNull(),
    fullArt: integer("full_art", { mode: "boolean" }).notNull(),
    textless: integer("textless", { mode: "boolean" }).notNull(),
    promo: integer("promo", { mode: "boolean" }).notNull(),
    variation: integer("variation", { mode: "boolean" }).notNull(),
    finishes: text("finishes", { mode: "json" }).$type<string[]>().notNull(),
    cardFaces: text("card_faces", { mode: "json" }).$type<unknown>(),
    imageUris: text("image_uris", { mode: "json" }).$type<Record<string, string>>(),
    scryfallUri: text("scryfall_uri").notNull(),

    prices: text("prices", { mode: "json" }).$type<Record<string, string | null>>().notNull(),

    // Populated later by the hash index build job (KAD-24) and packages/phash
    // (KAD-25): 8-byte big-endian buffer holding a 64-bit DCT hash.
    artPhash: blob("art_phash", { mode: "buffer" }),
    fullPhash: blob("full_phash", { mode: "buffer" }),

    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("cards_oracle_id_idx").on(table.oracleId),
    index("cards_name_idx").on(table.name),
    index("cards_set_collector_idx").on(table.setCode, table.collectorNumber),
  ],
);

export type CardRow = typeof cards.$inferSelect;
export type NewCardRow = typeof cards.$inferInsert;

export const SYNC_TYPES = ["cards", "prices", "hash_index"] as const;
export type SyncType = (typeof SYNC_TYPES)[number];

export const SYNC_STATUSES = ["never_run", "running", "success", "error"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

/** One row per sync type, upserted on every run - not a history log. */
export const syncState = sqliteTable("sync_state", {
  syncType: text("sync_type").primaryKey().$type<SyncType>(),
  status: text("status").notNull().$type<SyncStatus>(),
  rowCount: integer("row_count"),
  sourceTimestamp: text("source_timestamp"),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
  errorMessage: text("error_message"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export type SyncStateRow = typeof syncState.$inferSelect;
export type NewSyncStateRow = typeof syncState.$inferInsert;

/**
 * One row per physically distinct stack of identical copies (KAD-12). The
 * unique index below - not `binderLocation`/`language` being nullable - is
 * what makes adding the same card twice increment quantity instead of
 * creating a second row: SQLite treats each NULL in a unique index as
 * distinct from every other NULL, which would silently defeat the dedup, so
 * both columns are NOT NULL with an empty-string/"en" default applied at the
 * Zod boundary rather than relying on NULL as "unset".
 */
export const collectionItems = sqliteTable(
  "collection_items",
  {
    id: text("id").primaryKey(), // CollectionItemId
    scryfallId: text("scryfall_id")
      .notNull()
      .references(() => cards.id),
    finish: text("finish").notNull().$type<Finish>(),
    condition: text("condition").notNull().$type<Condition>(),
    quantity: integer("quantity").notNull(),
    isProxy: integer("is_proxy", { mode: "boolean" }).notNull(),
    binderLocation: text("binder_location").notNull(),
    language: text("language").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("collection_items_stack_idx").on(
      table.scryfallId,
      table.finish,
      table.condition,
      table.isProxy,
      table.binderLocation,
      table.language,
    ),
    index("collection_items_scryfall_id_idx").on(table.scryfallId),
  ],
);

export type CollectionItemRow = typeof collectionItems.$inferSelect;
export type NewCollectionItemRow = typeof collectionItems.$inferInsert;
