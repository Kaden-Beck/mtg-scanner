import { conditionSchema, finishSchema, scryfallIdSchema } from "@mtg/schemas";
import { z } from "zod";

/**
 * One exported stack (KAD-23). Deliberately *not* `CollectionItemRow`: an
 * export is a wire format that has to survive a round trip through a file,
 * so it carries the printing's human-readable identity (name / set /
 * collector number) alongside the Scryfall id, and it carries tags, which
 * live in a separate table.
 *
 * It omits `id`, `createdAt` and `updatedAt` on purpose. Those are local
 * bookkeeping, not facts about the physical collection: re-importing into a
 * fresh database has to produce equivalent stacks, not resurrect the row
 * identities of the database it came from. That is also what "lossless"
 * means for AC2 - every field that describes the collection survives, and
 * nothing that describes this particular SQLite file does.
 *
 * Kept apart from `rows.ts` (which runs the query) so the serializers can
 * import the shape without pulling in `db/client` and opening a connection
 * as a side effect of module evaluation.
 */
export const collectionExportRowSchema = z.object({
  scryfallId: scryfallIdSchema,
  name: z.string(),
  setCode: z.string(),
  setName: z.string(),
  collectorNumber: z.string(),
  quantity: z.number().int().positive(),
  finish: finishSchema,
  condition: conditionSchema,
  isProxy: z.boolean(),
  binderLocation: z.string(),
  language: z.string().min(1),
  tags: z.array(z.string()),
});
export type CollectionExportRow = z.infer<typeof collectionExportRowSchema>;
