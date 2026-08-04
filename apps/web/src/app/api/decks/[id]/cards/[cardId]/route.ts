import { assertNever, updateDeckCardRequestSchema } from "@mtg/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { getDeckCard, removeDeckCard, updateDeckCard } from "@/server/decks/decks";

interface RouteParams {
  params: Promise<{ id: string; cardId: string }>;
}

/**
 * `cardId` is a `deck_cards.id`, not a Scryfall id. The deck id in the path
 * is checked against the row rather than ignored: without it,
 * `/decks/A/cards/<entry-in-deck-B>` would happily edit deck B's card
 * through deck A's URL.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id, cardId } = await params;
  const body: unknown = await request.json().catch(() => null);
  const parsed = updateDeckCardRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const existing = getDeckCard(cardId);
  if (existing?.deckId !== id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = updateDeckCard(cardId, parsed.data);
  switch (result.outcome) {
    case "updated":
      return NextResponse.json({ card: result.row });
    case "not_found":
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    case "conflict":
      return NextResponse.json({ error: "conflict" }, { status: 409 });
    default:
      return assertNever(result);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id, cardId } = await params;
  const existing = getDeckCard(cardId);
  if (existing?.deckId !== id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  removeDeckCard(cardId);
  return new NextResponse(null, { status: 204 });
}
