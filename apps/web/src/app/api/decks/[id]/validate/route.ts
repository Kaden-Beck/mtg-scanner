import { connection, type NextRequest, NextResponse } from "next/server";
import { validateDeckById } from "@/server/decks/hydrate";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Validation is computed per request, never stored (KAD-30 AC3): the
 * `legalities` behind the verdict are read off the live `cards` rows, so a
 * banlist change from a bulk sync is reflected the next time this is called
 * with no user action.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  await connection();
  const { id } = await params;
  const result = validateDeckById(id);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ validation: result });
}
