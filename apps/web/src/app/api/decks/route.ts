import { createDeckRequestSchema } from "@mtg/schemas";
import { connection, type NextRequest, NextResponse } from "next/server";
import { CardNotFoundError, createDeck, listDecks } from "@/server/decks/decks";

// `connection()` opts this read out of a build-time snapshot - better-sqlite3
// is synchronous, so without it Next has no signal that this route is
// per-request and bakes the result into the static build permanently.
export async function GET() {
  await connection();
  return NextResponse.json({ decks: listDecks() });
}

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = createDeckRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const deck = createDeck(parsed.data);
    return NextResponse.json({ deck }, { status: 201 });
  } catch (error) {
    if (error instanceof CardNotFoundError) {
      return NextResponse.json({ error: "card_not_found" }, { status: 404 });
    }
    throw error;
  }
}
