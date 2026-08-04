import { z } from "zod";
import { type CollectionExportRow, collectionExportRowSchema } from "./row-schema";

/**
 * Bumped only on a breaking change to the row shape. An importer that finds
 * a version it doesn't know refuses the file rather than guessing at it -
 * silently misreading a backup is the worst outcome available here.
 */
export const COLLECTION_EXPORT_VERSION = 1;

export const collectionExportFileSchema = z.object({
  version: z.literal(COLLECTION_EXPORT_VERSION),
  exportedAt: z.iso.datetime(),
  items: z.array(collectionExportRowSchema),
});
export type CollectionExportFile = z.infer<typeof collectionExportFileSchema>;

/**
 * JSON is the lossless format (KAD-23). Every column survives, including
 * the three the Archidekt CSV shape has no notion of - `binderLocation`,
 * `isProxy` and tags - which is why the round-trip acceptance gate is
 * anchored here first and extended to CSV second.
 *
 * Pretty-printed: these are backups a person may well open, and the size
 * difference is irrelevant next to being able to read and diff one.
 */
export function toJson(rows: readonly CollectionExportRow[], exportedAt: Date): string {
  const file: CollectionExportFile = {
    version: COLLECTION_EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    items: [...rows],
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export type ParseJsonResult =
  | { readonly ok: true; readonly file: CollectionExportFile }
  | { readonly ok: false; readonly message: string };

/**
 * Reads an export file back. Returns a message rather than throwing,
 * because "this isn't one of our export files" is an ordinary thing for a
 * user to do by accident and needs to be shown to them, not logged.
 */
export function parseJson(text: string): ParseJsonResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "That file isn't valid JSON." };
  }

  const parsed = collectionExportFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
    return {
      ok: false,
      message: `That file isn't a collection export this app understands${where}: ${issue?.message ?? "unrecognized shape"}`,
    };
  }
  return { ok: true, file: parsed.data };
}
