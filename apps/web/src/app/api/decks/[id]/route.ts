import { updateDeckRequestSchema } from "@mtg/schemas";
import { connection, type NextRequest, NextResponse } from "next/server";
import { CardNotFoundError, deleteDeck, getDeck, updateDeck } from "@/server/decks/decks";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  await connection();
  const { id } = await params;
  const deck = getDeck(id);
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
    return NextResponse.json({ deck });
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
