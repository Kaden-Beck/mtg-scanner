import { z } from "zod";
import { oracleIdSchema, scryfallIdSchema } from "./ids";

/**
 * Validates a single object from the Scryfall bulk-data JSONL stream at the
 * ingest boundary (KAD-8). `@scryfall/api-types` gives compile-time shape
 * for code that already trusts a card object; this is the runtime gate that
 * earns that trust; it does not attempt to model every layout-specific
 * nuance of `card_faces` (that's a later story's problem) - `.loose()` lets
 * fields we don't validate pass through unchanged into the JSON columns.
 *
 * Field names follow Scryfall's API exactly (`set`, not `set_code`) so the
 * mapping to our DB column names stays a single explicit step in the
 * ingest job, not hidden in this schema.
 */
const cardFaceSchema = z
  .object({
    name: z.string(),
    mana_cost: z.string().optional(),
    type_line: z.string().optional(),
    oracle_text: z.string().optional(),
    colors: z.array(z.string()).optional(),
    image_uris: z.record(z.string(), z.string()).optional(),
  })
  .loose();

export const scryfallCardSchema = z
  .object({
    object: z.literal("card"),
    id: scryfallIdSchema,
    oracle_id: oracleIdSchema.optional(),
    name: z.string(),
    lang: z.string(),
    released_at: z.string(),
    layout: z.string(),
    mana_cost: z.string().optional(),
    cmc: z.number(),
    type_line: z.string(),
    oracle_text: z.string().optional(),
    colors: z.array(z.string()).optional(),
    color_identity: z.array(z.string()),
    keywords: z.array(z.string()),
    legalities: z.record(z.string(), z.string()),
    games: z.array(z.string()),
    reserved: z.boolean(),
    finishes: z.array(z.string()),
    card_faces: z.array(cardFaceSchema).optional(),

    set: z.string(),
    set_name: z.string(),
    set_type: z.string(),
    collector_number: z.string(),
    rarity: z.string(),

    artist: z.string().optional(),
    border_color: z.string(),
    frame: z.string(),
    full_art: z.boolean(),
    textless: z.boolean(),
    promo: z.boolean(),
    variation: z.boolean(),
    image_uris: z.record(z.string(), z.string()).optional(),
    // The artwork identity the hash index is keyed on (KAD-24): thousands of
    // printings are reprints of the same art, and hashing each one would be
    // ~96.5k images to store ~47.4k distinct hashes. Optional for the same
    // reason `oracle_id` is - reversible and double-faced layouts carry it
    // per-face rather than at the top level.
    illustration_id: z.string().optional(),
    scryfall_uri: z.string(),
    prices: z.record(z.string(), z.string().nullable()),
  })
  .loose();

export type ScryfallCard = z.infer<typeof scryfallCardSchema>;

/**
 * Bulk files include every object type in every product: tokens, emblems,
 * schemes, Vanguard, planar cards, and Un-set "funny" cards. Left in, these
 * pollute both search results and the hash index (KAD-24). Exclusion policy
 * is deliberately narrow - when in doubt, include, since a false exclusion
 * silently loses a card while a false inclusion is just noise.
 */
const EXCLUDED_LAYOUTS = new Set([
  "token",
  "double_faced_token",
  "emblem",
  "scheme",
  "vanguard",
  "planar",
  "art_series",
]);

const EXCLUDED_SET_TYPES = new Set(["memorabilia", "token", "minigame", "vanguard", "funny"]);

export function isCollectibleCard(card: ScryfallCard): boolean {
  return !EXCLUDED_LAYOUTS.has(card.layout) && !EXCLUDED_SET_TYPES.has(card.set_type);
}
