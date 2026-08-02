import { assertNever, importArchidektRequestSchema } from "@mtg/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { importArchidektCsv } from "@/server/import/archidekt";

/**
 * Takes CSV text directly (read client-side via FileReader) rather than
 * multipart form data - simpler request/response contract for a solo
 * project with no other multipart consumers yet.
 */
export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = importArchidektRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = importArchidektCsv(parsed.data);
  switch (result.outcome) {
    case "duplicate_detected":
      return NextResponse.json(
        { error: "duplicate_import", priorBatch: result.priorBatch },
        { status: 409 },
      );
    case "completed":
      return NextResponse.json({ batch: result.batch }, { status: 201 });
    default:
      return assertNever(result);
  }
}
