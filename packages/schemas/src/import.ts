import { z } from "zod";

/** Wire-shape contract for POST /api/import/archidekt (KAD-13). */
export const importArchidektRequestSchema = z.object({
  fileName: z.string().min(1),
  csvText: z.string(),
  duplicateAction: z.enum(["merge", "replace"]).optional(),
});
export type ImportArchidektRequest = z.infer<typeof importArchidektRequestSchema>;

/**
 * Wire-shape contract for POST /api/import/collection (KAD-23) - re-importing
 * this app's own JSON export.
 *
 * No `fileName` and no `duplicateAction`, unlike the Archidekt request above.
 * Duplicate detection there hashes the uploaded file to catch someone
 * uploading the same third-party export twice; re-importing your own backup
 * is a deliberate act with `createOrMergeCollectionItem` semantics, so there
 * is nothing to warn about and no filename to record.
 */
export const importCollectionJsonRequestSchema = z.object({
  jsonText: z.string(),
});
export type ImportCollectionJsonRequest = z.infer<typeof importCollectionJsonRequestSchema>;
