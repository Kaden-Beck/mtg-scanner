import { createDeckCardRequestSchema } from "@mtg/schemas";
import { connection, type NextRequest, NextResponse } from "next/server";
import {
  addOrMergeDeckCard,
  CardNotFoundError,
  DeckNotFoundError,
  getDeck,
  listDeckCards,
} from "@/server/decks/decks";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  await connection();
  const { id } = await params;
  if (!getDeck(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ cards: listDeckCards(id) });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);
  const parsed = createDeckCardRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const card = addOrMergeDeckCard(id, parsed.data);
    return NextResponse.json({ card }, { status: 201 });
  } catch (error) {
    if (error instanceof DeckNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (error instanceof CardNotFoundError) {
      return NextResponse.json({ error: "card_not_found" }, { status: 404 });
    }
    throw error;
  }
}
