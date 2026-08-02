import { NextResponse } from "next/server";
import { getSyncStatuses } from "@/server/sync/status";

export function GET() {
  return NextResponse.json({ statuses: getSyncStatuses() });
}
