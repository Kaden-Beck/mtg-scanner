import { NextResponse } from "next/server";
import { runBackup } from "@/server/backup/backup";

export async function POST() {
  const result = await runBackup();
  return NextResponse.json({ backup: result }, { status: 201 });
}
