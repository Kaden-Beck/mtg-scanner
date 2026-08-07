import { scanUndoRequestSchema } from "@mtg/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { undoScanCommit } from "@/server/scan/undo";

/**
 * Undo one scan session entry's quantity contribution (KAD-49).
 */
export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = scanUndoRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = undoScanCommit(parsed.data.collectionItemId, parsed.data.quantityDelta);
  if (result.outcome === "not_found") {
    return NextResponse.json(result, { status: 404 });
  }
  return NextResponse.json(result);
}
