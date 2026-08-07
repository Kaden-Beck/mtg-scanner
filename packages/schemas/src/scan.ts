import { z } from "zod";
import { conditionSchema, finishSchema } from "./card-attributes";
import { collectorNumberSchema, oracleIdSchema, scryfallIdSchema, setCodeSchema } from "./ids";

/**
 * Wire contracts for the OCR-primary scan APIs (KAD-44 resolve, KAD-48 commit).
 */

export const scanResolveRequestSchema = z.object({
  setCode: setCodeSchema,
  collectorNumber: collectorNumberSchema,
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
