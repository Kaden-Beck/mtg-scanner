import { z } from "zod";
import { conditionSchema, finishSchema } from "./card-attributes";
import { collectionItemIdSchema, scryfallIdSchema } from "./ids";

/**
 * Wire-shape contracts for the collection_items CRUD API (KAD-12).
 * `binderLocation`/`language` default at this boundary rather than at the
 * DB layer - see the comment on the `collectionItems` table for why they
 * must never be NULL.
 */
export const createCollectionItemRequestSchema = z.object({
  scryfallId: scryfallIdSchema,
  finish: finishSchema,
  condition: conditionSchema,
  quantity: z.number().int().positive(),
  isProxy: z.boolean().default(false),
  binderLocation: z.string().default(""),
  language: z.string().min(1).default("en"),
});
export type CreateCollectionItemRequest = z.infer<typeof createCollectionItemRequestSchema>;

const collectionItemPatchFields = {
  finish: finishSchema,
  condition: conditionSchema,
  quantity: z.number().int().positive(),
  isProxy: z.boolean(),
  binderLocation: z.string(),
  language: z.string().min(1),
};

export const updateCollectionItemRequestSchema = z
  .object(collectionItemPatchFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateCollectionItemRequest = z.infer<typeof updateCollectionItemRequestSchema>;

export const collectionItemResponseSchema = z.object({
  id: collectionItemIdSchema,
  scryfallId: scryfallIdSchema,
  finish: finishSchema,
  condition: conditionSchema,
  quantity: z.number().int().positive(),
  isProxy: z.boolean(),
  binderLocation: z.string(),
  language: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CollectionItemResponse = z.infer<typeof collectionItemResponseSchema>;
