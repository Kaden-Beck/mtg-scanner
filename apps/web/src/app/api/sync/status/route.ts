import { NextResponse } from "next/server";
import { getSyncStatuses } from "@/server/sync/status";

export async function GET() {
  return NextResponse.json({ statuses: await getSyncStatuses() });
}
