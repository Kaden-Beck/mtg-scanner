import { scanResolveRequestSchema } from "@mtg/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { resolvePrinting } from "@/server/scan/resolve";

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = scanResolveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = resolvePrinting(parsed.data.setCode, parsed.data.collectorNumber);
  if (!result.ok) {
    return NextResponse.json(result, { status: 404 });
  }
  return NextResponse.json(result);
}
