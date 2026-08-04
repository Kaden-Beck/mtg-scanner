import { z } from "zod";
import { assertNever } from "./assert-never";
import { deckCardIdSchema, deckIdSchema, scryfallIdSchema } from "./ids";

/**
 * Wire-shape contracts for the deck CRUD API (KAD-26).
 *
 * `format` is present from the start per the AC even though only
 * `commander` is validated in v1 (KAD-30) - carrying the column from day
 * one is cheaper than a migration later, and it keeps the validation
 * engine's entry point honest about being format-dispatched rather than
 * silently Commander-only.
 */
export const DECK_FORMATS = [
  "commander",
  "standard",
  "modern",
  "legacy",
  "vintage",
  "pauper",
  "pioneer",
  "brawl",
] as const;
export type DeckFormat = (typeof DECK_FORMATS)[number];
export const deckFormatSchema = z.enum(DECK_FORMATS);

/**
 * Maybe-board is deliberately part of the same table rather than a separate
 * "wishlist" concept: a card moves between main and maybe constantly while
 * brewing, and that should be an UPDATE of one column, not a delete plus an
 * insert into a different table.
 */
export const DECK_BOARDS = ["main", "side", "maybe"] as const;
export type DeckBoard = (typeof DECK_BOARDS)[number];
export const deckBoardSchema = z.enum(DECK_BOARDS);

export function deckBoardLabel(board: DeckBoard): string {
  switch (board) {
    case "main":
      return "Main";
    case "side":
      return "Sideboard";
    case "maybe":
      return "Maybe";
    default:
      return assertNever(board);
  }
}

export function deckFormatLabel(format: DeckFormat): string {
  switch (format) {
    case "commander":
      return "Commander";
    case "standard":
      return "Standard";
    case "modern":
      return "Modern";
    case "legacy":
      return "Legacy";
    case "vintage":
      return "Vintage";
    case "pauper":
      return "Pauper";
    case "pioneer":
      return "Pioneer";
    case "brawl":
      return "Brawl";
    default:
      return assertNever(format);
  }
}

/**
 * Categories are free-form user strings ("ramp", "removal", ...) with no
 * vocabulary table, same call as tags in KAD-22. Empty string rather than
 * NULL means "uncategorized" - see the `deckCards` table comment for why
 * NULL is not an option in a column that participates in a unique index.
 */
export const MAX_DECK_NAME_LENGTH = 200;
export const MAX_DECK_CATEGORY_LENGTH = 60;

const deckNameSchema = z.string().trim().min(1).max(MAX_DECK_NAME_LENGTH);
const deckCategorySchema = z.string().trim().max(MAX_DECK_CATEGORY_LENGTH);

export const createDeckRequestSchema = z.object({
  name: deckNameSchema,
  format: deckFormatSchema.default("commander"),
  description: z.string().default(""),
  commanderCardId: scryfallIdSchema.nullish(),
  partnerCardId: scryfallIdSchema.nullish(),
});
export type CreateDeckRequest = z.infer<typeof createDeckRequestSchema>;

export const updateDeckRequestSchema = z
  .object({
    name: deckNameSchema,
    format: deckFormatSchema,
    description: z.string(),
    // Nullable on purpose: clearing a commander is a real edit, and
    // `undefined` (absent) has to stay distinguishable from `null` (clear).
    commanderCardId: scryfallIdSchema.nullable(),
    partnerCardId: scryfallIdSchema.nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateDeckRequest = z.infer<typeof updateDeckRequestSchema>;

export const deckResponseSchema = z.object({
  id: deckIdSchema,
  name: z.string(),
  format: deckFormatSchema,
  description: z.string(),
  commanderCardId: scryfallIdSchema.nullable(),
  partnerCardId: scryfallIdSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type DeckResponse = z.infer<typeof deckResponseSchema>;

export const createDeckCardRequestSchema = z.object({
  scryfallId: scryfallIdSchema,
  board: deckBoardSchema.default("main"),
  category: deckCategorySchema.default(""),
  quantity: z.number().int().positive(),
});
export type CreateDeckCardRequest = z.infer<typeof createDeckCardRequestSchema>;

export const updateDeckCardRequestSchema = z
  .object({
    board: deckBoardSchema,
    category: deckCategorySchema,
    quantity: z.number().int().positive(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateDeckCardRequest = z.infer<typeof updateDeckCardRequestSchema>;

export const deckCardResponseSchema = z.object({
  id: deckCardIdSchema,
  deckId: deckIdSchema,
  scryfallId: scryfallIdSchema,
  board: deckBoardSchema,
  category: z.string(),
  quantity: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type DeckCardResponse = z.infer<typeof deckCardResponseSchema>;
