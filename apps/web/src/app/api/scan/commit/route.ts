import { scanCommitRequestSchema } from "@mtg/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { CardNotFoundError, commitScan } from "@/server/scan/commit";

/**
 * Commit a resolved scan into the collection (KAD-48).
 *
 * Quantity-merge semantics come from `createOrMergeCollectionItem` — scanning
 * the same physical stack twice increments quantity rather than duplicating.
 * Response includes `quantityAdded` so the session list can undo exactly this
 * capture (KAD-49).
 */
export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = scanCommitRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = commitScan(parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof CardNotFoundError) {
      return NextResponse.json({ error: "card_not_found" }, { status: 404 });
    }
    throw error;
  }
}
