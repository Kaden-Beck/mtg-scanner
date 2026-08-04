import { connection, type NextRequest, NextResponse } from "next/server";
import { suggestCards } from "@/server/decks/card-search";

/** Typeahead for the deck editor (KAD-27). Reuses the KAD-10 FTS index. */
export async function GET(request: NextRequest) {
  await connection();
  const query = request.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ cards: suggestCards(query) });
}
