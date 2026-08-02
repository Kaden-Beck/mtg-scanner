import { createCollectionItemRequestSchema } from "@mtg/schemas";
import { connection, type NextRequest, NextResponse } from "next/server";
import {
  CardNotFoundError,
  createOrMergeCollectionItem,
  listCollectionItems,
} from "@/server/collection/items";

// GET is the only method Cache Components can prerender (POST/PATCH/DELETE
// are never cached regardless) - `connection()` opts this read out of a
// build-time snapshot, same reasoning as the sync status page (KAD-9).
export async function GET(request: NextRequest) {
  await connection();
  const scryfallId = request.nextUrl.searchParams.get("scryfallId");
  const items = listCollectionItems(scryfallId ? { scryfallId } : undefined);
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = createCollectionItemRequestSchema.safeParse(body);
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
