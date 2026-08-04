/**
 * The pure half of the export route (KAD-23): which formats exist, what
 * they're called, and what they can carry. Split out from the route handler
 * because a handler that calls `connection()` can't be unit-tested by
 * invoking its exported `GET` directly - see the note in CLAUDE.md - so
 * everything with a decision in it lives here where it is directly testable.
 */

export const EXPORT_FORMATS = ["json", "csv", "moxfield"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: string): value is ExportFormat {
  return EXPORT_FORMATS.some((format) => format === value);
}

interface FormatDescriptor {
  readonly label: string;
  readonly extension: string;
  /** Includes the charset: these files carry card names, which are not ASCII. */
  readonly contentType: string;
  /** Null when the format carries everything; a sentence naming what it drops otherwise. */
  readonly lossyNote: string | null;
}

export const EXPORT_FORMAT_INFO: Readonly<Record<ExportFormat, FormatDescriptor>> = {
  json: {
    label: "JSON",
    extension: "json",
    contentType: "application/json; charset=utf-8",
    lossyNote: null,
  },
  csv: {
    label: "CSV",
    extension: "csv",
    contentType: "text/csv; charset=utf-8",
    lossyNote: null,
  },
  moxfield: {
    label: "Moxfield text",
    extension: "txt",
    contentType: "text/plain; charset=utf-8",
    // Stated rather than hidden: this is a deck-list format with nowhere to
    // put these fields, so it is lossy by design and the UI has to say so
    // instead of letting someone treat it as a backup.
    lossyNote:
      "Deck-list format - it carries quantity, card, set, number and foil only. Binder location, condition, proxy flag, language and tags are not included. Use JSON or CSV for a backup.",
  },
};

/**
 * A dated filename, so several exports in a downloads folder stay
 * distinguishable without the user renaming them.
 */
export function exportFilename(format: ExportFormat, exportedAt: Date): string {
  const date = exportedAt.toISOString().slice(0, 10);
  return `mtg-collection-${date}.${EXPORT_FORMAT_INFO[format].extension}`;
}
