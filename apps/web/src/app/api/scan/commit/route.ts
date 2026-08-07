import { scanCommitRequestSchema } from "@mtg/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { CardNotFoundError, createOrMergeCollectionItem } from "@/server/collection/items";

/**
 * Commit a resolved scan into the collection (KAD-48).
 *
 * Quantity-merge semantics come from `createOrMergeCollectionItem` — scanning
 * the same physical stack twice increments quantity rather than duplicating.
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
    const item = createOrMergeCollectionItem(parsed.data);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof CardNotFoundError) {
      return NextResponse.json({ error: "card_not_found" }, { status: 404 });
    }
    throw error;
  }
}
