import { connection, type NextRequest, NextResponse } from "next/server";
import { suggestCards } from "@/server/decks/card-search";

/**
 * Typeahead for the deck editor (KAD-27). Reuses the KAD-10 FTS index.
 *
 * `owned=1` is KAD-35's build mode. Absent or any other value means the full
 * catalogue - an unrecognized value must not silently narrow the search.
 */
export async function GET(request: NextRequest) {
  await connection();
  const params = request.nextUrl.searchParams;
  const query = params.get("q") ?? "";
  const ownedOnly = params.get("owned") === "1";
  return NextResponse.json({ cards: suggestCards(query, { ownedOnly }) });
}
