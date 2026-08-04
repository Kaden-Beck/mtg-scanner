import { connection } from "next/server";
import { toCsv } from "@/server/export/csv";
import { EXPORT_FORMAT_INFO, exportFilename, isExportFormat } from "@/server/export/formats";
import { toJson } from "@/server/export/json";
import { toMoxfieldText } from "@/server/export/moxfield";
import { gatherExportRows } from "@/server/export/rows";

/**
 * Collection export download (KAD-23 AC1). Kept as thin as possible: the
 * format table lives in `export/formats.ts` and the serializers in their own
 * modules, because `connection()` throws outside a real Next request scope,
 * so nothing tested by invoking `GET` directly can live in here (CLAUDE.md).
 */
export async function GET(request: Request): Promise<Response> {
  // Synchronous better-sqlite3 reads give Cache Components no signal that
  // this is per-request data - without this the export would be baked into
  // the build output once, permanently (KAD-9's trap).
  await connection();

  const requested = new URL(request.url).searchParams.get("format") ?? "json";
  if (!isExportFormat(requested)) {
    return Response.json(
      { error: `Unknown export format "${requested}". Use json, csv, or moxfield.` },
      { status: 400 },
    );
  }

  const exportedAt = new Date();
  const rows = gatherExportRows();
  const body =
    requested === "json"
      ? toJson(rows, exportedAt)
      : requested === "csv"
        ? toCsv(rows)
        : toMoxfieldText(rows);

  return new Response(body, {
    headers: {
      "content-type": EXPORT_FORMAT_INFO[requested].contentType,
      "content-disposition": `attachment; filename="${exportFilename(requested, exportedAt)}"`,
    },
  });
}
