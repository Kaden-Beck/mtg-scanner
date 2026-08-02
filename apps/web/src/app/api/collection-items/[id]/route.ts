import { assertNever, updateCollectionItemRequestSchema } from "@mtg/schemas";
import { connection, type NextRequest, NextResponse } from "next/server";
import {
  deleteCollectionItem,
  getCollectionItem,
  updateCollectionItem,
} from "@/server/collection/items";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  await connection();
  const { id } = await params;
  const item = getCollectionItem(id);
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);
  const parsed = updateCollectionItemRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = updateCollectionItem(id, parsed.data);
  switch (result.outcome) {
    case "updated":
      return NextResponse.json({ item: result.row });
    case "not_found":
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    case "conflict":
      return NextResponse.json({ error: "conflict" }, { status: 409 });
    default:
      return assertNever(result);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const deleted = deleteCollectionItem(id);
  if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
