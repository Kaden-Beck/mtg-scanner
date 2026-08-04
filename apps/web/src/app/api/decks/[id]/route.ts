import { updateDeckRequestSchema } from "@mtg/schemas";
import { connection, type NextRequest, NextResponse } from "next/server";
import { CardNotFoundError, deleteDeck, updateDeck } from "@/server/decks/decks";
import { hydrateDeck, hydrateDeckById } from "@/server/decks/hydrate";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  await connection();
  const { id } = await params;
  // Hydrated, so the response carries the derived color identity (KAD-28
  // AC1) - computed on read rather than stored, so a Scryfall erratum in a
  // later sync lands without the user re-entering anything.
  const deck = hydrateDeckById(id);
  if (!deck) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ deck });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);
  const parsed = updateDeckRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const deck = updateDeck(id, parsed.data);
    if (!deck) return NextResponse.json({ error: "not_found" }, { status: 404 });
    // Hydrated too: setting a commander must show its identity immediately,
    // which is the observable half of KAD-28's AC1.
    return NextResponse.json({ deck: hydrateDeck(deck) });
  } catch (error) {
    if (error instanceof CardNotFoundError) {
      return NextResponse.json({ error: "card_not_found" }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const deleted = deleteDeck(id);
  if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
