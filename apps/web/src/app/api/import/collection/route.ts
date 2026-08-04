import { assertNever, importCollectionJsonRequestSchema } from "@mtg/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { importCollectionJson } from "@/server/import/collection-json";

/**
 * Re-imports this app's own JSON export (KAD-23 AC2), completing the loop
 * that `GET /api/export?format=json` starts. Without this the export is a
 * file the app can write and never read, and "round-trips losslessly" would
 * be a property only the test suite could observe.
 *
 * Takes JSON text as a string field rather than the export object inline,
 * matching the Archidekt route's `csvText` shape: the client reads the file
 * with FileReader and posts its contents, and the version check inside
 * `parseJson` gets to reject an unknown file with its own message instead of
 * the request schema rejecting it as a malformed body.
 */
export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = importCollectionJsonRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = importCollectionJson(parsed.data.jsonText);
  switch (result.outcome) {
    case "invalid":
      // 422, not 400: the request itself was well-formed, the file inside it
      // wasn't. The distinction is what lets a client show the user
      // `message` (which names what it choked on) rather than a generic
      // "bad request".
      return NextResponse.json({ error: "invalid_file", message: result.message }, { status: 422 });
    case "completed":
      // Skipped rows are reported, never silently dropped - a printing this
      // database doesn't know about is exactly the case where a quiet
      // success would cost someone part of their collection.
      return NextResponse.json(
        { imported: result.imported, skipped: result.skipped },
        { status: 201 },
      );
    default:
      return assertNever(result);
  }
}
