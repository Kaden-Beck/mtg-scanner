import { z } from "zod";

/**
 * MTG data is full of opaque, near-identical string identifiers (Scryfall
 * printing UUIDs, Oracle card UUIDs, set codes, collector numbers). Branding
 * them at the parse boundary makes it a compile error to pass one where
 * another belongs, instead of a runtime bug discovered in production.
 *
 * Construct these only by parsing through the schemas below - never via `as`.
 */

export const scryfallIdSchema = z.uuid().brand<"ScryfallId">();
export type ScryfallId = z.infer<typeof scryfallIdSchema>;

export const oracleIdSchema = z.uuid().brand<"OracleId">();
export type OracleId = z.infer<typeof oracleIdSchema>;

export const setCodeSchema = z.string().min(1).max(6).toLowerCase().brand<"SetCode">();
export type SetCode = z.infer<typeof setCodeSchema>;

export const collectorNumberSchema = z.string().min(1).brand<"CollectorNumber">();
export type CollectorNumber = z.infer<typeof collectorNumberSchema>;
