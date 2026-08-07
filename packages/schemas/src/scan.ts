import { z } from "zod";
import { conditionSchema, finishSchema } from "./card-attributes";
import { collectionItemResponseSchema } from "./collection-item";
import {
  collectionItemIdSchema,
  collectorNumberSchema,
  oracleIdSchema,
  scryfallIdSchema,
  setCodeSchema,
} from "./ids";

/**
 * Wire contracts for the OCR-primary scan APIs (KAD-44 resolve, KAD-48 commit,
 * KAD-49 undo).
 */

export const scanResolveRequestSchema = z
  .object({
    setCode: setCodeSchema,
    collectorNumber: collectorNumberSchema.optional(),
    /** Title-bar OCR fallback when the CN strip is ambiguous. */
    name: z.string().min(1).max(120).optional(),
  })
  .refine((value) => Boolean(value.collectorNumber || value.name), {
    message: "Either collectorNumber or name is required",
  });
export type ScanResolveRequest = z.infer<typeof scanResolveRequestSchema>;

export const scanResolvedCardSchema = z.object({
  scryfallId: scryfallIdSchema,
  oracleId: oracleIdSchema.nullable(),
  name: z.string(),
  setCode: z.string(),
  collectorNumber: z.string(),
  sharedArt: z.boolean(),
});
export type ScanResolvedCard = z.infer<typeof scanResolvedCardSchema>;

export const scanResolveResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    card: scanResolvedCardSchema,
  }),
  z.object({
    ok: z.literal(false),
    error: z.literal("not_found"),
    suggestions: z.array(z.string()),
  }),
]);
export type ScanResolveResponse = z.infer<typeof scanResolveResponseSchema>;

export const scanCommitRequestSchema = z.object({
  scryfallId: scryfallIdSchema,
  finish: finishSchema,
  condition: conditionSchema.default("NM"),
  quantity: z.number().int().positive().default(1),
  isProxy: z.boolean().default(false),
  binderLocation: z.string().default(""),
  language: z.string().min(1).default("en"),
});
export type ScanCommitRequest = z.infer<typeof scanCommitRequestSchema>;

/**
 * `quantityAdded` is the delta from this commit (not the stack total), so the
 * session list can undo exactly what this capture contributed.
 */
export const scanCommitResponseSchema = z.object({
  item: collectionItemResponseSchema,
  quantityAdded: z.number().int().positive(),
});
export type ScanCommitResponse = z.infer<typeof scanCommitResponseSchema>;

export const scanUndoRequestSchema = z.object({
  collectionItemId: collectionItemIdSchema,
  quantityDelta: z.number().int().positive(),
});
export type ScanUndoRequest = z.infer<typeof scanUndoRequestSchema>;

export const scanUndoResponseSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("decremented"),
    item: collectionItemResponseSchema,
  }),
  z.object({
    outcome: z.literal("deleted"),
    collectionItemId: collectionItemIdSchema,
  }),
  z.object({
    outcome: z.literal("not_found"),
  }),
]);
export type ScanUndoResponse = z.infer<typeof scanUndoResponseSchema>;
